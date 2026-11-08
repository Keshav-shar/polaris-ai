import { createGuardrailAgent } from "../application/agents/guardrail.agent";
import { createExpandAgent } from "../application/agents/expand.agent";
import { createInsightAgent } from "../application/agents/insight.agent";
import { createRetrievalAgent } from "../application/agents/retrieval.agent";
import { verifyExpansion } from "../application/agents/verifier.agent";
import { createWriterAgent } from "../application/agents/writer.agent";
import { createStructuredGenerator, type GenerateStructured } from "../application/llm/structured";
import type { DedupPort } from "../application/ports/dedup.port";
import type { InsightQueuePort } from "../application/ports/insight.port";
import type { NodeQueueConsumerPort, NodeQueuePort } from "../application/ports/node-queue.port";
import type { NodeStatePort } from "../application/ports/node-state.port";
import type { RateWindowPort } from "../application/ports/rate-window.port";
import type { RunStatePort } from "../application/ports/run-state.port";
import { createNodeConstructor } from "../application/tree/construct-node";
import { createExpansionCacheDep } from "../application/tree/expansion-cache";
import { createFanIn } from "../application/tree/fan-in";
import { createRunFinishedNotifier } from "../application/tree/run-finished";
import { createExpandNode, type ExpandNode } from "../application/use-cases/expand-node.use-case";
import { createHaltRun, type HaltRun } from "../application/use-cases/halt-run.use-case";
import {
  createHandleDeadLetter,
  type HandleDeadLetter,
} from "../application/use-cases/handle-dead-letter.use-case";
import { createRefreshInsight, type RefreshInsight } from "../application/use-cases/refresh-insight.use-case";
import { createWriteArticle, type WriteArticle } from "../application/use-cases/write-article.use-case";
import type { Env } from "../config/env";
import type { InsightMessage } from "../domain/schemas/insight.schema";
import type { NodeMessage } from "../domain/schemas/queue-message.schema";
import { createMemoryDedupStore } from "../infrastructure/memory/memory-dedup.store";
import { createMemoryInsightQueue } from "../infrastructure/memory/memory-insight-queue.adapter";
import { createMemoryNodeQueue } from "../infrastructure/memory/memory-node-queue.adapter";
import { createMemoryNodeStateStore } from "../infrastructure/memory/memory-node-state.store";
import { createMemoryRateWindowStore } from "../infrastructure/memory/memory-rate-window.store";
import { createMemoryRunStateStore } from "../infrastructure/memory/memory-run-state.store";
import {
  createLocalQueueWorker,
  type LocalQueueWorker,
} from "../interfaces/workers/local-queue-worker";
import { failureReason } from "../shared/failure-reason";
import type { Logger } from "../shared/logger";
import { createLlmFromEnv } from "./llm";
import { createReadStack, type ReadStack } from "./read-stack";
import { secretValues } from "./secrets";
import { createSearchFromEnv } from "./search";
import { createMemoryStorage, type Storage } from "./storage";

export type LlmUsageTotals = {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  ms: number;
  truncated: number;
};

// The in-flight half of the build path: queues and the stores behind the idempotency rules. In memory for
// QUEUE_MODE=memory, SQS + DynamoDB for the Lambdas (Phase 13) - the use-cases cannot tell which (C35, C108).
export type BuildInfra = {
  queue: NodeQueuePort;
  articleQueue: NodeQueuePort;
  nodeState: NodeStatePort;
  runState: RunStatePort;
  dedup: DedupPort;
  rateWindow: RateWindowPort;
  // A factory, because the in-process runner needs the refresh use-case as its handler and that use-case is built
  // here. An SQS queue ignores the handler: its consumer is the refresh-insight Lambda.
  insightQueue(handle: (message: InsightMessage) => Promise<unknown>): InsightQueuePort & { idle?(): Promise<void> };
};

// Everything the build path does, over any BuildInfra: the LLM-free read stack plus the workers' use-cases.
export type CoreStack = ReadStack & {
  // The model actually answering right now, which pool rotation changes mid-run. Reporting the
  // CONFIGURED lead after a rotation would name a model that may not have answered anything (C69).
  activeModel(): string;
  // Structured LLM calls made so far, by label (expand-root, expand, writer, insight). Logical calls: a repair or
  // a retry inside one call is not counted again. What the smoke run reports as "requests per tree".
  llmCalls(): Record<string, number>;
  // Provider REQUESTS by label, repairs and retries included, with what they cost: tokens and time (C116).
  llmUsage(): Record<string, LlmUsageTotals>;
  expandNode: ExpandNode;
  writeArticle: WriteArticle;
  handleDeadLetter: HandleDeadLetter;
  haltRun: HaltRun;
  // Phase C (C139): the learner-insight job, and a hook resolving once every queued refresh has run (memory only).
  refreshInsight: RefreshInsight;
  insightsIdle(): Promise<void>;
  // The one-line, redacted reason stored for a failure (C90, C103).
  describeFailure(error: unknown): string;
  infra: BuildInfra;
};

export type BuildStack = CoreStack & {
  worker: LocalQueueWorker;
  // The second pass's consumer. Started alongside the first: construction finishing is what feeds it.
  articleWorker: LocalQueueWorker;
};

// Priority order on both queues (C128): a boosted node first, then shallower depth, then arrival. For
// construction, depth order is the breadth-first order it already followed. Two instances of the same queue,
// not two adapters: NodeMessage carries `pass` and both the queue and the worker are generic over it (C35).
export function createMemoryInfra(
  env: Env,
  logger: Logger,
): BuildInfra & { queue: NodeQueueConsumerPort & NodeQueuePort; articleQueue: NodeQueueConsumerPort & NodeQueuePort } {
  return {
    queue: createMemoryNodeQueue({ order: "priority" }),
    articleQueue: createMemoryNodeQueue({ order: "priority" }),
    nodeState: createMemoryNodeStateStore(),
    runState: createMemoryRunStateStore(env.MAX_NODES_PER_RUN),
    dedup: createMemoryDedupStore(),
    rateWindow: createMemoryRateWindowStore(),
    insightQueue: (handle) => createMemoryInsightQueue({ handle, logger }),
  };
}

// The DI root for the build path. The only place its adapters meet; the memory stack below and the Lambda worker
// container (worker-container.ts) both build on it, so no use-case wiring exists twice.
export function createCoreStack(env: Env, logger: Logger, { storage, infra }: { storage: Storage; infra: BuildInfra }): CoreStack {
  const { runRepo, treeRepo, articleRepo, quizStore } = storage;
  const { queue, articleQueue, nodeState, runState, dedup } = infra;
  const usage = new Map<string, LlmUsageTotals>();
  const llmStack = createLlmFromEnv(
    env,
    logger,
    (event) => {
      const totals = usage.get(event.label) ?? {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        reasoningTokens: 0,
        ms: 0,
        truncated: 0,
      };
      totals.requests += 1;
      totals.promptTokens += event.promptTokens ?? 0;
      totals.completionTokens += event.completionTokens ?? 0;
      totals.reasoningTokens += event.reasoningTokens ?? 0;
      totals.ms += event.ms;
      if (event.finishReason === "length") totals.truncated += 1;
      usage.set(event.label, totals);
    },
    // A13: on AWS this window is shared by every warm container through DynamoDB.
    { window: infra.rateWindow },
  );
  const calls = new Map<string, number>();
  const counted =
    (inner: GenerateStructured): GenerateStructured =>
    (request) => {
      calls.set(request.label, (calls.get(request.label) ?? 0) + 1);
      return inner(request);
    };
  const generate = counted(createStructuredGenerator(llmStack.llm));
  // The writer gets its own generator, over its own pool when one is configured (C92). Same instance
  // otherwise, so nothing changes without LLM_*_WRITER_MODELS.
  const generateArticle =
    llmStack.writerLlm === llmStack.llm ? generate : counted(createStructuredGenerator(llmStack.writerLlm));

  const constructor = createNodeConstructor({
    expand: createExpandAgent({ generate }).expand,
    verify: verifyExpansion,
    logger,
    // The cache is keyed by NAMESPACE, not by whichever model answered: a rotating pool changes the
    // answering model per call, and construct-node derives the key before the call but writes after it.
    // Passed as a getter because the stack is free to change what it namespaces on (C69).
    cache: createExpansionCacheDep({
      cache: storage.expansionCache,
      namespace: llmStack.cacheNamespace,
    }),
  });

  // The learner-insight job (C139): one small call per refresh on the EXPAND pool - the cheap one, at low effort -
  // in the lowest priority lane, off its own queue.
  const refreshInsight = createRefreshInsight({
    feedback: storage.feedback,
    progress: storage.progress,
    insights: storage.insights,
    usage: storage.usage,
    agent: createInsightAgent({ generate }),
    logger,
  });
  const insightQueue = infra.insightQueue(refreshInsight.execute);
  const onRunFinished = createRunFinishedNotifier({ runRepo, insightQueue, logger });
  const fanIn = createFanIn({ nodeState, treeRepo, runState, runRepo, onRunFinished });

  const expandNode = createExpandNode({
    nodeState,
    dedup,
    treeRepo,
    runRepo,
    queue,
    // An expanded node hands itself to the second pass at once (C91), so construction is where the
    // article queue is written to - the fan-in no longer sends anything.
    articleQueue,
    runState,
    fanIn,
    constructor,
    maxNodesPerRun: env.MAX_NODES_PER_RUN,
    logger,
  });
  const writeArticle = createWriteArticle({
    nodeState,
    treeRepo,
    articleRepo,
    quizStore,
    evidenceRepo: storage.evidenceRepo,
    retrieval: createRetrievalAgent({ search: createSearchFromEnv(env, logger) }),
    guardrail: createGuardrailAgent(),
    writer: createWriterAgent({ generate: generateArticle }),
    fanIn,
    logger,
  });
  // Every configured secret, not only the LLM key: a search or storage error may echo its own (C103).
  const describeFailure = (error: unknown): string => failureReason(error, secretValues(env));

  return {
    ...createReadStack(env, logger, {
      storage,
      queue,
      articleQueue,
      nodeState,
      runState,
      // The pool's budget: every member's requests/day summed, or undefined if any is unknown (C93).
      dailyRequestBudget: llmStack.dailyRequestBudget,
    }),
    activeModel: llmStack.activeModel,
    llmCalls: () => Object.fromEntries(calls),
    llmUsage: () => Object.fromEntries([...usage].map(([label, totals]) => [label, { ...totals }])),
    expandNode,
    writeArticle,
    handleDeadLetter: createHandleDeadLetter({ fanIn, logger, describeFailure }),
    haltRun: createHaltRun({ runRepo, runState, logger, onRunFinished }),
    refreshInsight,
    insightsIdle: () => insightQueue.idle?.() ?? Promise.resolve(),
    describeFailure,
    infra,
  };
}

// QUEUE_MODE=memory: the core stack over in-memory infra, plus the two local workers that drain it in-process.
export function createBuildStack(
  env: Env,
  logger: Logger,
  // Mirrors the worker's port: the message carries the runId, and an async handler is awaited before
  // idle() releases the caller (docs/conflicts.md C55).
  options: {
    onFatal?: (error: unknown, message: NodeMessage) => void | Promise<void>;
    // The permanent stores. Defaults to fresh in-memory ones, which is what the smoke and eval scripts want: a
    // CLI run must never write to the real database. The API container passes createStorageFromEnv's (C137).
    storage?: Storage;
  } = {},
): BuildStack {
  const storage = options.storage ?? createMemoryStorage();
  const infra = createMemoryInfra(env, logger);
  const core = createCoreStack(env, logger, { storage, infra });
  const onFatal = async (error: unknown, message: NodeMessage): Promise<void> => {
    // The run must record the stall before idle() lets the caller read it, or a halted build still looks like it
    // is constructing (C55).
    await core.haltRun.execute(message.runId, error);
    await options.onFatal?.(error, message);
  };
  return {
    ...core,
    worker: createLocalQueueWorker({
      queue: infra.queue,
      handle: core.expandNode.execute,
      onDeadLetter: core.handleDeadLetter.execute,
      concurrency: env.WORKER_EXPAND_CONCURRENCY,
      logger,
      onFatal,
    }),
    // Its own worker and its own concurrency, because the article pass costs a search AND an LLM call per node
    // (Q11), and since C91 it draws on the provider AT THE SAME TIME as construction. A quota stall halts the run
    // here too.
    articleWorker: createLocalQueueWorker({
      queue: infra.articleQueue,
      // No lease locally: the memory queue promotes in place and never copies a message (A18).
      handle: (message) => core.writeArticle.execute(message),
      onDeadLetter: core.handleDeadLetter.execute,
      concurrency: env.WORKER_ARTICLE_CONCURRENCY,
      logger,
      onFatal,
    }),
  };
}

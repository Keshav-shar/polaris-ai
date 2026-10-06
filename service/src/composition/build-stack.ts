import { createConsolidatorAgent } from "../application/agents/consolidator.agent";
import { createGuardrailAgent } from "../application/agents/guardrail.agent";
import { createExpandAgent } from "../application/agents/expand.agent";
import { createParserAgent } from "../application/agents/parser.agent";
import { createRetrievalAgent } from "../application/agents/retrieval.agent";
import { verifyExpansion } from "../application/agents/verifier.agent";
import { createWriterAgent } from "../application/agents/writer.agent";
import { createStructuredGenerator } from "../application/llm/structured";
import { createNodeConstructor } from "../application/tree/construct-node";
import { createExpansionCacheDep } from "../application/tree/expansion-cache";
import { createFanIn } from "../application/tree/fan-in";
import { createExpandNode, type ExpandNode } from "../application/use-cases/expand-node.use-case";
import { createGetNode, type GetNode } from "../application/use-cases/get-node.use-case";
import { createGetTree, type GetTree } from "../application/use-cases/get-tree.use-case";
import { createListRuns, type ListRuns } from "../application/use-cases/list-runs.use-case";
import { createHaltRun } from "../application/use-cases/halt-run.use-case";
import {
  createHandleDeadLetter,
  type HandleDeadLetter,
} from "../application/use-cases/handle-dead-letter.use-case";
import {
  createStartTreeBuild,
  type StartTreeBuild,
} from "../application/use-cases/start-tree-build.use-case";
import { createWriteArticle, type WriteArticle } from "../application/use-cases/write-article.use-case";
import type { Env } from "../config/env";
import { failureReason } from "../shared/failure-reason";
import type { NodeMessage } from "../domain/schemas/queue-message.schema";
import { createMemoryArticleRepository } from "../infrastructure/memory/memory-article.repository";
import { createMemoryDedupStore } from "../infrastructure/memory/memory-dedup.store";
import { createMemoryExpansionCache } from "../infrastructure/memory/memory-expansion-cache.store";
import { createMemoryNodeQueue } from "../infrastructure/memory/memory-node-queue.adapter";
import { createMemoryNodeStateStore } from "../infrastructure/memory/memory-node-state.store";
import { createMemoryQuizStore } from "../infrastructure/memory/memory-quiz.store";
import { createMemoryRunRepository } from "../infrastructure/memory/memory-run.repository";
import { createMemoryRunStateStore } from "../infrastructure/memory/memory-run-state.store";
import { createMemoryTreeRepository } from "../infrastructure/memory/memory-tree.repository";
import {
  createLocalQueueWorker,
  type LocalQueueWorker,
} from "../interfaces/workers/local-queue-worker";
import { randomUuid } from "../shared/ids";
import type { Logger } from "../shared/logger";
import { createLlmFromEnv, llmKeys } from "./llm";
import { createSearchFromEnv } from "./search";

export type BuildStack = {
  // The model actually answering right now, which pool rotation changes mid-run. Reporting the
  // CONFIGURED lead after a rotation would name a model that may not have answered anything (C69).
  activeModel(): string;
  startTreeBuild: StartTreeBuild;
  getTree: GetTree;
  getNode: GetNode;
  listRuns: ListRuns;
  expandNode: ExpandNode;
  writeArticle: WriteArticle;
  handleDeadLetter: HandleDeadLetter;
  worker: LocalQueueWorker;
  // The second pass's consumer. Started alongside the first: construction finishing is what feeds it.
  articleWorker: LocalQueueWorker;
};

// The DI root for the construction path on QUEUE_MODE=memory. The only place adapters are constructed;
// Phase 7's container.ts branches on QUEUE_MODE around this instead of duplicating the wiring, and Phase
// 13 swaps the memory adapters for SQS/DynamoDB here without any use-case changing.
export function createBuildStack(
  env: Env,
  logger: Logger,
  // Mirrors the worker's port: the message carries the runId, and an async handler is awaited before
  // idle() releases the caller (docs/conflicts.md C55). Narrowing it here would hide both from a caller
  // such as Phase 7's container.ts.
  options: { onFatal?: (error: unknown, message: NodeMessage) => void | Promise<void> } = {},
): BuildStack {
  const llmStack = createLlmFromEnv(env, logger);
  const generate = createStructuredGenerator(llmStack.llm);
  // The writer gets its own generator, over its own pool when one is configured (C92). Same instance
  // otherwise, so nothing changes without LLM_*_WRITER_MODELS.
  const generateArticle =
    llmStack.writerLlm === llmStack.llm ? generate : createStructuredGenerator(llmStack.writerLlm);

  const constructor = createNodeConstructor({
    expand: createExpandAgent({ generate }).expand,
    verify: verifyExpansion,
    consolidate: createConsolidatorAgent({ generate }).consolidate,
    logger,
    // The cache is keyed by NAMESPACE, not by whichever model answered: a rotating pool changes the
    // answering model per call, and construct-node derives the key before the call but writes after it.
    // Passed as a getter because the stack is free to change what it namespaces on (C69).
    cache: createExpansionCacheDep({
      cache: createMemoryExpansionCache(),
      namespace: llmStack.cacheNamespace,
    }),
  });

  const queue = createMemoryNodeQueue();
  const nodeState = createMemoryNodeStateStore();
  const runState = createMemoryRunStateStore(env.MAX_NODES_PER_RUN);
  const treeRepo = createMemoryTreeRepository();
  const runRepo = createMemoryRunRepository();
  // A SECOND instance of the same in-memory queue, not a new adapter: NodeMessage already carries
  // `pass`, and both the queue and the worker are generic over it (docs/conflicts.md C35 - two passes,
  // two queues, still true now that they overlap in time). Phase 13 swaps each for its own SQS queue.
  const articleQueue = createMemoryNodeQueue();
  const fanIn = createFanIn({ nodeState, treeRepo, runState, runRepo });

  const expandNode = createExpandNode({
    nodeState,
    dedup: createMemoryDedupStore(),
    treeRepo,
    queue,
    // An expanded node hands itself to the second pass at once (C91), so construction is where the
    // article queue is written to - the fan-in no longer sends anything.
    articleQueue,
    runState,
    fanIn,
    constructor,
    logger,
  });
  // One instance of each, shared by the writer and the reader: two would mean the API read from a store
  // nothing ever wrote to.
  const articleRepo = createMemoryArticleRepository();
  const quizStore = createMemoryQuizStore();
  const writeArticle = createWriteArticle({
    nodeState,
    treeRepo,
    articleRepo,
    quizStore,
    retrieval: createRetrievalAgent({ search: createSearchFromEnv(env) }),
    guardrail: createGuardrailAgent(),
    writer: createWriterAgent({ generate: generateArticle }),
    fanIn,
    logger,
  });
  const describeFailure = (error: unknown): string => failureReason(error, llmKeys(env));
  const handleDeadLetter = createHandleDeadLetter({ fanIn, logger, describeFailure });
  const haltRun = createHaltRun({ runRepo, logger });

  return {
    activeModel: llmStack.activeModel,
    startTreeBuild: createStartTreeBuild({
      parser: createParserAgent({ generate, logger }),
      // Randomness enters the system here and nowhere else.
      ids: { next: randomUuid },
      runRepo,
      queue,
      logger,
      // The pool's budget: every member's requests/day summed, or undefined if any is unknown (C93).
      dailyRequestBudget: llmStack.dailyRequestBudget,
      // Cost guard: MAX_NODES_PER_RUN bounds one run, this bounds how many run at once (C61).
      maxConcurrentRuns: env.MAX_CONCURRENT_RUNS,
    }),
    getTree: createGetTree({ runRepo, treeRepo, runState }),
    getNode: createGetNode({ treeRepo, articleRepo, quizStore }),
    listRuns: createListRuns({ runs: runRepo }),
    expandNode,
    writeArticle,
    handleDeadLetter,
    worker: createLocalQueueWorker({
      queue,
      handle: expandNode.execute,
      onDeadLetter: handleDeadLetter.execute,
      concurrency: env.WORKER_EXPAND_CONCURRENCY,
      logger,
      // The run must record the stall before idle() lets the caller read it, or a halted build still
      // looks like it is constructing (docs/conflicts.md C55).
      onFatal: async (error, message) => {
        await haltRun.execute(message.runId, error);
        await options.onFatal?.(error, message);
      },
    }),
    // Its own worker and its own concurrency, because the article pass costs a search AND an LLM call per
    // node (Q11: start at 2 + 2), and since C91 it draws on the provider AT THE SAME TIME as construction.
    // A quota stall halts the run here too - the same reason as construction.
    articleWorker: createLocalQueueWorker({
      queue: articleQueue,
      handle: writeArticle.execute,
      onDeadLetter: handleDeadLetter.execute,
      concurrency: env.WORKER_ARTICLE_CONCURRENCY,
      logger,
      onFatal: async (error, message) => {
        await haltRun.execute(message.runId, error);
        await options.onFatal?.(error, message);
      },
    }),
  };
}

import { createConsolidatorAgent } from "../application/agents/consolidator.agent";
import { createExpandAgent } from "../application/agents/expand.agent";
import { createParserAgent } from "../application/agents/parser.agent";
import { verifyExpansion } from "../application/agents/verifier.agent";
import { createStructuredGenerator } from "../application/llm/structured";
import { createNodeConstructor } from "../application/tree/construct-node";
import { createExpansionCacheDep } from "../application/tree/expansion-cache";
import { createFanIn } from "../application/tree/fan-in";
import { createExpandNode, type ExpandNode } from "../application/use-cases/expand-node.use-case";
import { createGetTree, type GetTree } from "../application/use-cases/get-tree.use-case";
import { createHaltRun } from "../application/use-cases/halt-run.use-case";
import {
  createHandleDeadLetter,
  type HandleDeadLetter,
} from "../application/use-cases/handle-dead-letter.use-case";
import {
  createStartTreeBuild,
  type StartTreeBuild,
} from "../application/use-cases/start-tree-build.use-case";
import type { Env } from "../config/env";
import type { NodeMessage } from "../domain/schemas/queue-message.schema";
import { createMemoryDedupStore } from "../infrastructure/memory/memory-dedup.store";
import { createMemoryExpansionCache } from "../infrastructure/memory/memory-expansion-cache.store";
import { createMemoryNodeQueue } from "../infrastructure/memory/memory-node-queue.adapter";
import { createMemoryNodeStateStore } from "../infrastructure/memory/memory-node-state.store";
import { createMemoryRunRepository } from "../infrastructure/memory/memory-run.repository";
import { createMemoryRunStateStore } from "../infrastructure/memory/memory-run-state.store";
import { createMemoryTreeRepository } from "../infrastructure/memory/memory-tree.repository";
import {
  createLocalQueueWorker,
  type LocalQueueWorker,
} from "../interfaces/workers/local-queue-worker";
import { randomUuid } from "../shared/ids";
import type { Logger } from "../shared/logger";
import { createLlmFromEnv } from "./llm";

export type BuildStack = {
  // The model actually answering right now, which a failover changes mid-run. Reporting the CONFIGURED
  // model after a switch would name the provider that stopped working (docs/conflicts.md C59).
  activeModel(): string;
  startTreeBuild: StartTreeBuild;
  getTree: GetTree;
  expandNode: ExpandNode;
  handleDeadLetter: HandleDeadLetter;
  worker: LocalQueueWorker;
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

  const constructor = createNodeConstructor({
    expand: createExpandAgent({ generate }).expand,
    verify: verifyExpansion,
    consolidate: createConsolidatorAgent({ generate }).consolidate,
    logger,
    // The model is part of the cache key, so switching provider namespaces the cache rather than
    // corrupting it. Passed as a getter: a failover changes the model mid-run (C59).
    cache: createExpansionCacheDep({ cache: createMemoryExpansionCache(), model: llmStack.activeModel }),
  });

  const queue = createMemoryNodeQueue();
  const nodeState = createMemoryNodeStateStore();
  const runState = createMemoryRunStateStore(env.MAX_NODES_PER_RUN);
  const treeRepo = createMemoryTreeRepository();
  const runRepo = createMemoryRunRepository();
  const fanIn = createFanIn({ nodeState, treeRepo, runState, runRepo });

  const expandNode = createExpandNode({
    nodeState,
    dedup: createMemoryDedupStore(),
    treeRepo,
    queue,
    runState,
    fanIn,
    constructor,
    logger,
  });
  const handleDeadLetter = createHandleDeadLetter({ fanIn, logger });
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
      // The ACTIVE profile's budget, or both profiles' combined when failover is wired (C58, C59).
      dailyRequestBudget: llmStack.dailyRequestBudget,
      // Cost guard: MAX_NODES_PER_RUN bounds one run, this bounds how many run at once (C61).
      maxConcurrentRuns: env.MAX_CONCURRENT_RUNS,
    }),
    getTree: createGetTree({ runRepo, treeRepo, runState }),
    expandNode,
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
  };
}

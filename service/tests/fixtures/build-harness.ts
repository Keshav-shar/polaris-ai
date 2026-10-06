import { verifyExpansion } from "../../src/application/agents/verifier.agent";
import { createNodeConstructor } from "../../src/application/tree/construct-node";
import { createFanIn } from "../../src/application/tree/fan-in";
import { createExpandNode } from "../../src/application/use-cases/expand-node.use-case";
import { createGetTree } from "../../src/application/use-cases/get-tree.use-case";
import { createHaltRun } from "../../src/application/use-cases/halt-run.use-case";
import { createHandleDeadLetter } from "../../src/application/use-cases/handle-dead-letter.use-case";
import { createStartTreeBuild } from "../../src/application/use-cases/start-tree-build.use-case";
import { WORKER } from "../../src/config/constants";
import { createMemoryDedupStore } from "../../src/infrastructure/memory/memory-dedup.store";
import { createMemoryNodeQueue } from "../../src/infrastructure/memory/memory-node-queue.adapter";
import { createMemoryNodeStateStore } from "../../src/infrastructure/memory/memory-node-state.store";
import { createMemoryRunRepository } from "../../src/infrastructure/memory/memory-run.repository";
import { createMemoryRunStateStore } from "../../src/infrastructure/memory/memory-run-state.store";
import { createMemoryTreeRepository } from "../../src/infrastructure/memory/memory-tree.repository";
import { createLocalQueueWorker } from "../../src/interfaces/workers/local-queue-worker";
import { fakeExpander, type FakeExpanderOptions } from "./fake-expander";
import { failureReason } from "../../src/shared/failure-reason";
import { fakeLogger } from "./fake-generate";

export type HarnessOptions = FakeExpanderOptions & {
  maxDepth?: number;
  concurrency?: number;
  dailyRequestBudget?: number;
  maxNodesPerRun?: number;
  // Undefined = no cost guard, which is what most tests want; set it to exercise the 429 path (C61).
  maxConcurrentRuns?: number;
};

// The whole in-memory construction stack with a fake expander in place of the LLM. The memory adapters
// ARE the test doubles - they enforce the same conditions their DynamoDB/Postgres twins must, so a test
// that passes here is a test of the real coordination logic, not of a simplified stand-in.
export function buildHarness(options: HarnessOptions = {}) {
  const {
    maxDepth = 2,
    concurrency = WORKER.EXPAND_CONCURRENCY,
    dailyRequestBudget,
    maxNodesPerRun,
    maxConcurrentRuns,
    ...expanderOptions
  } = options;
  const expander = fakeExpander(expanderOptions);
  const { logger, warnings, logs } = fakeLogger();
  const log = { ...logger, error: (msg: string, context?: Record<string, unknown>) => void warnings.push({ msg, context }) };

  const constructor = createNodeConstructor({
    expand: expander.expand,
    verify: verifyExpansion,
    consolidate: async ({ children }) => [...children],
    logger,
  });

  const queue = createMemoryNodeQueue();
  const nodeState = createMemoryNodeStateStore();
  const runState = createMemoryRunStateStore(maxNodesPerRun);
  const treeRepo = createMemoryTreeRepository();
  const runRepo = createMemoryRunRepository();
  const dedup = createMemoryDedupStore();
  const articleQueue = createMemoryNodeQueue();
  const fanIn = createFanIn({ nodeState, treeRepo, runState, runRepo });

  // No article worker here: there is no writer in this harness. Construction still FILLS articleQueue
  // (C91 - each expanded node sends its own article message), which is exactly what these tests read.
  const expandNode = createExpandNode({
    nodeState,
    dedup,
    treeRepo,
    queue,
    articleQueue,
    runState,
    fanIn,
    constructor,
    logger: log,
  });
  const handleDeadLetter = createHandleDeadLetter({
    fanIn,
    logger: log,
    // The real formatter, not a stub: a test asserting on a stored reason should see what ships.
    describeFailure: (error) => failureReason(error),
  });
  const haltRun = createHaltRun({ runRepo, logger: log });

  let nextId = 0;
  const startTreeBuild = createStartTreeBuild({
    // Deterministic ids: a counter in a v4-shaped string, so NodeMessage's uuid checks still pass.
    ids: { next: () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}` },
    parser: { parse: async (raw: string) => ({ topic: raw, maxDepth }) },
    runRepo,
    queue,
    logger: log,
    dailyRequestBudget,
    maxConcurrentRuns,
  });

  const fatals: unknown[] = [];
  const worker = createLocalQueueWorker({
    queue,
    handle: expandNode.execute,
    onDeadLetter: handleDeadLetter.execute,
    concurrency,
    logger: log,
    // Mirrors composition/build-stack.ts: the run records the stall before idle() releases the caller.
    onFatal: async (error, message) => {
      fatals.push(error);
      await haltRun.execute(message.runId, error);
    },
  });

  return {
    expander,
    warnings,
    logs,
    fatals,
    queue,
    // The second pass's queue, so a test can read the article messages construction sent as it went.
    articleQueue,
    nodeState,
    runState,
    treeRepo,
    runRepo,
    dedup,
    fanIn,
    expandNode,
    handleDeadLetter,
    startTreeBuild,
    getTree: createGetTree({ runRepo, treeRepo, runState }),
    worker,
    // Runs a whole tree from a prompt and returns the run id.
    async build(prompt: string): Promise<string> {
      const { runId } = await startTreeBuild.execute(prompt);
      worker.start();
      await worker.idle();
      await worker.stop();
      return runId;
    },
  };
}

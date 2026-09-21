import { RunInProgressError } from "../../domain/errors/run-in-progress.error";
import type { StartTreeResponse } from "../../domain/schemas/api.schema";
import { ParsedRequest } from "../../domain/schemas/node.schema";
import { estimateExpandCalls } from "../../domain/traversal/estimate-expand-calls";
import type { Logger } from "../../shared/logger";
import type { ParserAgent } from "../agents/parser.agent";
import type { IdGeneratorPort } from "../ports/id-generator.port";
import type { NodeQueuePort } from "../ports/node-queue.port";
import type { RunRepositoryPort } from "../ports/run-repository.port";
import { rootConstructMessage } from "../tree/messages";

export type StartTreeBuildDeps = {
  parser: ParserAgent;
  ids: IdGeneratorPort;
  runRepo: RunRepositoryPort;
  queue: NodeQueuePort;
  logger: Pick<Logger, "info" | "warn">;
  // The active provider's requests-per-day, when it has one. Undefined = no known ceiling to warn about.
  dailyRequestBudget?: number | undefined;
  // Runs allowed to be `constructing` at once. Undefined = no guard, which is what a single-run caller such
  // as scripts/smoke-node.ts wants; the HTTP container always passes env.MAX_CONCURRENT_RUNS (C61).
  maxConcurrentRuns?: number | undefined;
};

export type StartTreeBuildOptions = {
  // Overrides the depth the parser inferred. Clamped to [1, MAX_DEPTH_CEILING] like any other depth.
  // Used by scripts/smoke-node.ts to keep a real run's cost predictable.
  maxDepth?: number;
};

export type StartTreeBuild = {
  execute(prompt: string, options?: StartTreeBuildOptions): Promise<StartTreeResponse>;
};

// Kickoff. The build itself never runs inside the request: this only sends the root message and returns,
// so POST /api/trees can answer 202 immediately (docs/free-tier-constraints.md).
export function createStartTreeBuild({
  parser,
  ids,
  runRepo,
  queue,
  logger,
  dailyRequestBudget,
  maxConcurrentRuns,
}: StartTreeBuildDeps): StartTreeBuild {
  return {
    async execute(prompt, options) {
      // BEFORE the parser call: a refused request must cost zero LLM requests, or the guard meant to save
      // quota would spend some of it on every rejection.
      if (maxConcurrentRuns !== undefined) {
        const active = await runRepo.countActive();
        if (active >= maxConcurrentRuns) throw new RunInProgressError(active, maxConcurrentRuns);
      }

      // A QuotaExhaustedError here propagates before any run exists, so there is nothing to clean up.
      const inferred = await parser.parse(prompt);
      const parsed =
        options?.maxDepth === undefined
          ? inferred
          : ParsedRequest.parse({ topic: inferred.topic, maxDepth: options.maxDepth });
      // Warn, never shrink: an over-budget depth is the caller's call to make, and silently lowering it
      // would hand back a different tree than the one asked for (docs/conflicts.md C57). The run goes
      // ahead and stops when the quota does, with everything built so far still in the tree.
      const estimatedCalls = estimateExpandCalls(parsed.maxDepth);
      if (dailyRequestBudget !== undefined && estimatedCalls > dailyRequestBudget) {
        logger.warn("build exceeds the provider daily budget", {
          maxDepth: parsed.maxDepth,
          estimatedCalls,
          dailyRequestBudget,
          note: "building anyway - the run will stop early and return a partial tree",
        });
      } else {
        logger.info("build estimate", { maxDepth: parsed.maxDepth, estimatedCalls });
      }

      const runId = ids.next();
      await runRepo.create({ runId, topic: parsed.topic, maxDepth: parsed.maxDepth, status: "constructing" });
      await queue.send(rootConstructMessage(runId, parsed));
      return { runId };
    },
  };
}

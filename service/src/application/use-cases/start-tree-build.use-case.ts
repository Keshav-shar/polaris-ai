import { DEFAULT_MAX_DEPTH, MAX_DEPTH_CEILING, TOPIC_MAX_CHARS } from "../../config/constants";
import { RunInProgressError } from "../../domain/errors/run-in-progress.error";
import type { StartTreeResponse } from "../../domain/schemas/api.schema";
import { parseDepthHint } from "../../domain/traversal/depth-hint";
import { estimateCalls } from "../../domain/traversal/estimate-calls";
import type { Logger } from "../../shared/logger";
import type { IdGeneratorPort } from "../ports/id-generator.port";
import type { NodeQueuePort } from "../ports/node-queue.port";
import type { RunRepositoryPort } from "../ports/run-repository.port";
import { rootConstructMessage } from "../tree/messages";

export type StartTreeBuildDeps = {
  ids: IdGeneratorPort;
  runRepo: RunRepositoryPort;
  queue: NodeQueuePort;
  logger: Pick<Logger, "info" | "warn">;
  // The active provider's requests-per-day, when it has one. Undefined = no known ceiling to warn about.
  dailyRequestBudget?: number | undefined;
  // Runs allowed to be `constructing` at once. Undefined = no guard, which is what a single-run caller such
  // as scripts/smoke-node.ts wants; the HTTP container always passes env.MAX_CONCURRENT_RUNS (C61).
  maxConcurrentRuns?: number | undefined;
  // MAX_NODES_PER_RUN, so the estimate is bounded the way the run is.
  maxNodesPerRun?: number | undefined;
};

export type StartTreeBuildOptions = {
  // Overrides any depth the prompt states. Clamped to [1, MAX_DEPTH_CEILING] like any other depth.
  // Used by POST /api/trees (optional body field) and scripts/smoke-node.ts to keep a run's cost predictable.
  maxDepth?: number;
};

export type StartTreeBuild = {
  execute(prompt: string, options?: StartTreeBuildOptions): Promise<StartTreeResponse>;
};

// The run is listed under this until the root call names the canonical topic (C100): the request itself,
// whitespace collapsed and cut at a word boundary.
export function provisionalTopic(prompt: string): string {
  const flat = prompt.trim().replace(/\s+/g, " ");
  if (flat.length <= TOPIC_MAX_CHARS) return flat;
  const cut = flat.slice(0, TOPIC_MAX_CHARS - 1);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > TOPIC_MAX_CHARS / 2 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}

// Kickoff. Makes NO LLM call (C100): the parser's two jobs moved - the depth to a pure regex over the request
// (or the body's maxDepth), the topic into the root expansion. So an accepted request costs zero provider
// requests inside the HTTP call, exactly as a refused one always did, and the build itself never runs inside
// the request: this sends the root message and returns, so POST /api/trees answers 202 immediately.
export function createStartTreeBuild({
  ids,
  runRepo,
  queue,
  logger,
  dailyRequestBudget,
  maxConcurrentRuns,
  maxNodesPerRun,
}: StartTreeBuildDeps): StartTreeBuild {
  return {
    async execute(prompt, options) {
      if (maxConcurrentRuns !== undefined) {
        const active = await runRepo.countActive();
        if (active >= maxConcurrentRuns) throw new RunInProgressError(active, maxConcurrentRuns);
      }

      // An explicit override outside the range is refused, never quietly clamped: the caller asked for a
      // specific tree. A depth merely MENTIONED in the prompt is clamped by parseDepthHint, as the parser did.
      const override = options?.maxDepth;
      if (override !== undefined && (!Number.isInteger(override) || override < 1 || override > MAX_DEPTH_CEILING)) {
        throw new RangeError(`maxDepth must be an integer in [1, ${MAX_DEPTH_CEILING}], got ${override}`);
      }
      const request = prompt.trim();
      const maxDepth = override ?? parseDepthHint(request) ?? DEFAULT_MAX_DEPTH;
      // Warn, never shrink: an over-budget depth is the caller's call to make, and silently lowering it
      // would hand back a different tree than the one asked for (docs/conflicts.md C57). The run goes
      // ahead and stops when the quota does, with everything built so far still in the tree.
      const estimate = estimateCalls(
        maxDepth,
        maxNodesPerRun === undefined ? {} : { maxNodes: maxNodesPerRun },
      );
      if (dailyRequestBudget !== undefined && estimate.total > dailyRequestBudget) {
        logger.warn("build exceeds the provider daily budget", {
          maxDepth,
          estimatedCalls: estimate.total,
          dailyRequestBudget,
          note: "building anyway - the run will stop early and return a partial tree",
        });
      } else {
        logger.info("build estimate", { maxDepth, ...estimate });
      }

      const runId = ids.next();
      const topic = provisionalTopic(request);
      await runRepo.create({ runId, topic, maxDepth, status: "constructing" });
      await queue.send(rootConstructMessage(runId, { topic, maxDepth, request }));
      return { runId };
    },
  };
}

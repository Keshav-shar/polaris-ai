import { DEFAULT_MAX_DEPTH, MAX_DEPTH_CEILING, TOPIC_MAX_CHARS } from "../../config/constants";
import { RunInProgressError } from "../../domain/errors/run-in-progress.error";
import { UnauthenticatedError } from "../../domain/errors/unauthenticated.error";
import { UserQuotaExhaustedError } from "../../domain/errors/user-quota-exhausted.error";
import type { StartTreeResponse } from "../../domain/schemas/api.schema";
import type { Caller } from "../../domain/schemas/caller.schema";
import type { LearnerProfile } from "../../domain/schemas/insight.schema";
import { parseDepthHint } from "../../domain/traversal/depth-hint";
import { estimateCalls } from "../../domain/traversal/estimate-calls";
import type { Logger } from "../../shared/logger";
import type { IdGeneratorPort } from "../ports/id-generator.port";
import type { InsightPort } from "../ports/insight.port";
import type { NodeQueuePort } from "../ports/node-queue.port";
import type { RunRepositoryPort } from "../ports/run-repository.port";
import type { UsagePort } from "../ports/usage.port";
import { rootConstructMessage } from "../tree/messages";

// The per-user guards (C105). Present exactly when auth is on: then building needs a caller, and both caps apply.
export type UserLimits = {
  usage: UsagePort;
  maxRunsPerDay: number;
  // The new run included: the caller keeps at most this many maps, the oldest private finished ones pruned.
  maxStoredRuns: number;
  now?: () => number;
};

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
  // Absent = auth off (no Supabase, C137): runs are ownerless and no per-user limit applies, as before Phase 12.
  users?: UserLimits | undefined;
  // The learner insights (C139). Read once per build for a signed-in caller - one row, no LLM call - and carried
  // on the root message. Absent = builds are never personalised.
  insights?: InsightPort | undefined;
};

export type StartTreeBuildOptions = {
  // Overrides any depth the prompt states. Clamped to [1, MAX_DEPTH_CEILING] like any other depth.
  // Used by POST /api/trees (optional body field) and scripts/smoke-node.ts to keep a run's cost predictable.
  maxDepth?: number;
  // Who is building. Required when the deps carry `users`; the run is then theirs and private.
  caller?: Caller | undefined;
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

// Retry-After for the daily cap: the counter is per UTC day, so the wait is until the next UTC midnight.
export function msUntilUtcMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - nowMs;
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
  users,
  insights,
}: StartTreeBuildDeps): StartTreeBuild {
  return {
    async execute(prompt, options) {
      // Every refusal below happens before any work, so it costs nothing - and the daily reservation is taken
      // LAST among them, so a request refused for another reason never spends one of the caller's builds.
      const caller = options?.caller;
      if (users !== undefined && caller === undefined) {
        throw new UnauthenticatedError("Sign in to build a learning map.");
      }
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
      if (users !== undefined && caller !== undefined) {
        const allowed = await users.usage.reserveRun(caller.userId, users.maxRunsPerDay);
        if (!allowed) {
          throw new UserQuotaExhaustedError(users.maxRunsPerDay, msUntilUtcMidnight((users.now ?? Date.now)()));
        }
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

      // Room for the new one: keep maxStoredRuns - 1 of the old. Pruned BEFORE the create, so a failure here
      // leaves no half-started run behind.
      const pruned =
        users !== undefined && caller !== undefined
          ? await runRepo.pruneForOwner(caller.userId, users.maxStoredRuns - 1)
          : 0;
      if (pruned > 0) logger.info("pruned old runs for the stored-run cap", { pruned, cap: users?.maxStoredRuns });

      const runId = ids.next();
      const topic = provisionalTopic(request);
      await runRepo.create({
        runId,
        topic,
        maxDepth,
        status: "constructing",
        ...(caller === undefined ? {} : { ownerId: caller.userId, visibility: "private" as const, request }),
      });
      // Optional by nature: a missing or unreadable insight builds the map un-personalised rather than refusing it.
      let learner: LearnerProfile | undefined;
      if (insights !== undefined && caller !== undefined) {
        try {
          learner = (await insights.get(caller.userId))?.profile;
        } catch (error) {
          logger.warn("learner insight unavailable: building without it", { runId, error });
        }
      }
      await queue.send(rootConstructMessage(runId, { topic, maxDepth, request, learner }));
      return pruned > 0 ? { runId, prunedRuns: pruned } : { runId };
    },
  };
}

import type { AuthVerifierPort } from "../application/ports/auth-verifier.port";
import type { BoostArticle } from "../application/use-cases/boost-article.use-case";
import type { GetNode } from "../application/use-cases/get-node.use-case";
import type { GetTree } from "../application/use-cases/get-tree.use-case";
import type { ListRuns } from "../application/use-cases/list-runs.use-case";
import type { RecordProgress } from "../application/use-cases/record-progress.use-case";
import type { SetLessonFeedback } from "../application/use-cases/set-lesson-feedback.use-case";
import type { SubmitQuizAttempt } from "../application/use-cases/submit-quiz-attempt.use-case";
import type { SetRunVisibility } from "../application/use-cases/set-run-visibility.use-case";
import type { StartTreeBuild } from "../application/use-cases/start-tree-build.use-case";
import { type Env, isLlmConfigured } from "../config/env";
import { StorageNotReadyError } from "../domain/errors/storage-not-ready.error";
import type { Logger } from "../shared/logger";
import { createAuthVerifierFromEnv } from "./auth";
import { createAwsKickoffInfra } from "./aws-infra";
import { type BuildStack, createBuildStack } from "./build-stack";
import { createReadStack, type ReadStack } from "./read-stack";
import { createStorageFromEnv } from "./storage";

// What a learner sees on a map that was building when the process stopped (memory queues only).
export const INTERRUPTED_RUN_REASON =
  "The server restarted while this map was being built, so it stopped here. Start it again to finish it.";

// What the Express process needs from the construction path. The use-cases are behind accessors because
// the stack is built on FIRST USE, not at boot: createBuildStack -> createLlmFromEnv -> requireLlmEnv
// throws EnvError when the active profile is incomplete, and an API whose job is to answer 503 must not
// die on that at startup (docs/conflicts.md C64).
export type ApiContainer = {
  // For GET /health only. Says nothing about whether the stack was ever built.
  llmConfigured: boolean;
  // Sign-in is required to build (Supabase configured, C105). For /health and the auth middleware.
  authRequired: boolean;
  // undefined when auth is off. Built eagerly: it needs no LLM, only the Supabase URL.
  authVerifier: AuthVerifierPort | undefined;
  // QUEUE_MODE=memory + Postgres: halts runs a previous process left building, which can never finish now that
  // its queues are gone. Resolves how many were halted; call once at startup. A no-op with memory storage.
  recoverInterruptedRuns(): Promise<number>;
  // Postgres only: one cheap read that throws StorageNotReadyError when the migrations were never applied, so the
  // problem is named at startup rather than by the first learner's failed build. A no-op with memory storage.
  checkStorage(): Promise<void>;
  // Also guarantees the local worker is draining. Throws EnvError when the LLM is not configured.
  startTreeBuild(): StartTreeBuild;
  // Read path: never starts the worker, so a halted run keeps reading as halted.
  getTree(): GetTree;
  // Read path, same rule: listing runs must not start a build.
  listRuns(): ListRuns;
  getNode(): GetNode;
  // Reorders queued work only, so it never starts a worker: a halted run stays halted (C128).
  boostArticle(): BoostArticle;
  setRunVisibility(): SetRunVisibility;
  // Phase C. Read-path-like: none of them starts a worker or makes an LLM call.
  submitQuizAttempt(): SubmitQuizAttempt;
  recordProgress(): RecordProgress;
  setLessonFeedback(): SetLessonFeedback;
  shutdown(): Promise<void>;
};

export function createContainer(env: Env, logger: Logger): ApiContainer {
  // QUEUE_MODE=memory: the whole build stack, workers included. QUEUE_MODE=sqs: Express only kicks off and reads -
  // the Lambdas build - so it holds the LLM-free read stack over SQS + DynamoDB and needs no LLM env (A12).
  let stack: BuildStack | undefined;
  let kickoff: ReadStack | undefined;
  // Built once, eagerly and LLM-free, so the startup sweep and the stack share the same stores.
  const storage = createStorageFromEnv(env);
  const authVerifier = createAuthVerifierFromEnv(env);

  // Memoized only on success: fixing service/.env and sending another request then works without a restart.
  const built = (): ReadStack => {
    if (env.QUEUE_MODE === "sqs") {
      kickoff ??= createReadStack(env, logger, {
        storage,
        ...createAwsKickoffInfra(env, storage),
        // Kickoff only estimates against the budget; the pool itself lives in the Lambdas.
        dailyRequestBudget: env.LLM_DAILY_REQUEST_BUDGET,
      });
      return kickoff;
    }
    stack ??= createBuildStack(env, logger, { storage });
    return stack;
  };

  return {
    // Under sqs the LLM is the Lambdas' concern: Express can always start a build.
    llmConfigured: env.QUEUE_MODE === "sqs" || isLlmConfigured(env),
    authRequired: storage.kind === "postgres",
    authVerifier,

    async checkStorage() {
      if (storage.kind !== "postgres") return;
      // Every table and late column, not one table: a half-applied schema (0001-0012 pushed, 0013-0015 not) let
      // the library work while every lesson answered 503 (C143). Names exactly what is missing.
      const missing = await storage.probeSchema();
      if (missing.length > 0) throw new StorageNotReadyError("schema check", `missing: ${missing.join(", ")}`);
    },

    async recoverInterruptedRuns() {
      // Only a permanent store outlives the process, and only in-memory queues die with it.
      if (storage.kind !== "postgres" || env.QUEUE_MODE !== "memory") return 0;
      return storage.runRepo.haltInterrupted(INTERRUPTED_RUN_REASON);
    },

    startTreeBuild() {
      if (env.QUEUE_MODE === "sqs") return built().startTreeBuild;
      built();
      const current = stack as BuildStack;
      // Idempotent while running, and it clears a halt: after a quota stall the worker stays halted with
      // the stalled message still queued, so the next run would sit at `constructing` forever (C55).
      current.worker.start();
      // Started here too, not lazily on the first article: since C91 the FIRST expansion already sends an
      // article message, so a stopped article worker would leave scrolls queued from the very first node.
      current.articleWorker.start();
      return current.startTreeBuild;
    },

    getTree() {
      return built().getTree;
    },

    listRuns() {
      return built().listRuns;
    },

    getNode() {
      return built().getNode;
    },

    boostArticle() {
      return built().boostArticle;
    },

    setRunVisibility() {
      return built().setRunVisibility;
    },

    submitQuizAttempt() {
      return built().submitQuizAttempt;
    },

    recordProgress() {
      return built().recordProgress;
    },

    setLessonFeedback() {
      return built().setLessonFeedback;
    },

    async shutdown() {
      // Both passes, or a SIGTERM would leave the article worker draining into a dying process.
      await Promise.all([stack?.worker.stop(), stack?.articleWorker.stop()]);
      // A refresh already queued finishes rather than being cut off mid-write.
      await stack?.insightsIdle();
    },
  };
}

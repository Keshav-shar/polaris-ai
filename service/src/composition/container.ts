import type { GetNode } from "../application/use-cases/get-node.use-case";
import type { GetTree } from "../application/use-cases/get-tree.use-case";
import type { ListRuns } from "../application/use-cases/list-runs.use-case";
import type { StartTreeBuild } from "../application/use-cases/start-tree-build.use-case";
import { type Env, EnvError, isLlmConfigured } from "../config/env";
import type { Logger } from "../shared/logger";
import { type BuildStack, createBuildStack } from "./build-stack";

// What the Express process needs from the construction path. The use-cases are behind accessors because
// the stack is built on FIRST USE, not at boot: createBuildStack -> createLlmFromEnv -> requireLlmEnv
// throws EnvError when the active profile is incomplete, and an API whose job is to answer 503 must not
// die on that at startup (docs/conflicts.md C64).
export type ApiContainer = {
  // For GET /health only. Says nothing about whether the stack was ever built.
  llmConfigured: boolean;
  // Also guarantees the local worker is draining. Throws EnvError when the LLM is not configured.
  startTreeBuild(): StartTreeBuild;
  // Read path: never starts the worker, so a halted run keeps reading as halted.
  getTree(): GetTree;
  // Read path, same rule: listing runs must not start a build.
  listRuns(): ListRuns;
  getNode(): GetNode;
  shutdown(): Promise<void>;
};

export function createContainer(env: Env, logger: Logger): ApiContainer {
  let stack: BuildStack | undefined;

  // Memoized only on success: fixing service/.env and sending another request then works without a restart.
  const built = (): BuildStack => {
    if (stack === undefined) {
      if (env.QUEUE_MODE === "sqs") {
        throw new EnvError(
          "QUEUE_MODE=sqs is not implemented until Phase 13. Set QUEUE_MODE=memory in service/.env " +
            "(see docs/setup.md).",
        );
      }
      stack = createBuildStack(env, logger);
    }
    return stack;
  };

  return {
    llmConfigured: isLlmConfigured(env),

    startTreeBuild() {
      const current = built();
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

    async shutdown() {
      // Both passes, or a SIGTERM would leave the article worker draining into a dying process.
      await Promise.all([stack?.worker.stop(), stack?.articleWorker.stop()]);
    },
  };
}

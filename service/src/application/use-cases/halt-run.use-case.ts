import type { RunRepositoryPort } from "../ports/run-repository.port";
import type { Logger } from "../../shared/logger";

export type HaltRunDeps = {
  runRepo: RunRepositoryPort;
  logger: Pick<Logger, "error">;
};

export type HaltRun = {
  execute(runId: string, error: unknown): Promise<void>;
};

// The worker halts itself on an unrecoverable stall (today: the LLM daily quota). The run must say so, or
// it sits at `constructing` forever and the UI polls for a tree that will never arrive - the same defect
// C52 fixed for a failed root. Whatever was built stays in the tree store and is still served by getTree.
export function createHaltRun({ runRepo, logger }: HaltRunDeps): HaltRun {
  return {
    async execute(runId, error) {
      const reason = error instanceof Error ? error.message : String(error);
      await runRepo.setStatus(runId, "halted", reason);
      logger.error("run halted", { runId, reason });
    },
  };
}

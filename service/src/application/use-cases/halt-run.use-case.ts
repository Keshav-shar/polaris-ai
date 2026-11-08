import { statsOf } from "../../domain/entities/run-stats";
import type { RunRepositoryPort } from "../ports/run-repository.port";
import type { RunStatePort } from "../ports/run-state.port";
import type { Logger } from "../../shared/logger";
import type { RunFinished } from "../tree/run-finished";

export type HaltRunDeps = {
  runRepo: RunRepositoryPort;
  // Optional so a caller with no counters to copy still halts; composition always passes it (C107).
  runState?: RunStatePort;
  logger: Pick<Logger, "error">;
  // A halted map still taught something: its learner's feedback is worth an insight refresh (C139). Never throws.
  onRunFinished?: RunFinished | undefined;
};

export type HaltRun = {
  execute(runId: string, error: unknown): Promise<void>;
};

// The worker halts itself on an unrecoverable stall (today: the LLM daily quota). The run must say so, or
// it sits at `constructing` forever and the UI polls for a tree that will never arrive - the same defect
// C52 fixed for a failed root. Whatever was built stays in the tree store and is still served by getTree.
export function createHaltRun({ runRepo, runState, logger, onRunFinished }: HaltRunDeps): HaltRun {
  return {
    async execute(runId, error) {
      const reason = error instanceof Error ? error.message : String(error);
      await runRepo.setStatus(runId, "halted", reason);
      // A16: the in-flight flag every queue consumer checks, so a fleet stops spending on this run.
      await runState?.halt(runId, Date.now());
      // A terminal transition: the counters are copied now, because the in-flight ones expire (C107).
      const counted = await runState?.get(runId);
      if (counted !== undefined) await runRepo.setStats(runId, statsOf(counted));
      logger.error("run halted", { runId, reason });
      await onRunFinished?.(runId);
    },
  };
}

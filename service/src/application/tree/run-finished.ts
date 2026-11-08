import type { Logger } from "../../shared/logger";
import type { InsightQueuePort } from "../ports/insight.port";
import type { RunRepositoryPort } from "../ports/run-repository.port";

// Called once a run reaches `done` or `halted` (C139). An owned run queues a learner-insight refresh; an ownerless
// one (auth off) has no learner to learn about.
export type RunFinished = (runId: string) => Promise<void>;

// Best effort by design: the caller is the article handler or the halt path, and neither may fail - or be
// redelivered - because the insight could not be queued. The job is idempotent, so a lost message costs only a
// later refresh (the learner's next finished map queues another).
export function createRunFinishedNotifier({
  runRepo,
  insightQueue,
  logger,
}: {
  runRepo: RunRepositoryPort;
  insightQueue: InsightQueuePort;
  logger: Pick<Logger, "warn">;
}): RunFinished {
  return async (runId) => {
    try {
      const run = await runRepo.get(runId);
      if (run?.ownerId === undefined) return;
      await insightQueue.send({ userId: run.ownerId, runId });
    } catch (error) {
      logger.warn("could not queue a learner insight refresh", { runId, error });
    }
  };
}

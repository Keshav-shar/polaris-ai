import type { InsightQueuePort } from "../../application/ports/insight.port";
import type { InsightMessage } from "../../domain/schemas/insight.schema";
import type { Logger } from "../../shared/logger";

export type MemoryInsightQueue = InsightQueuePort & {
  // Resolves once every message sent so far has been handled: the deterministic hook for tests and scripts.
  idle(): Promise<void>;
};

// The insight queue for QUEUE_MODE=memory (C139): messages run one at a time, in the background, never inside the
// request or the article handler that sent them. A failed refresh is logged and dropped rather than redelivered -
// the job is idempotent and keyed on "new signals since the last insight", so the learner's next finished map
// simply tries again. On SQS (Phase 13) the queue's own redrive gives it retries.
// The handler is injected (composition passes the use-case) because infrastructure may not import use-cases.
export function createMemoryInsightQueue({
  handle,
  logger,
}: {
  handle(message: InsightMessage): Promise<unknown>;
  logger: Pick<Logger, "warn">;
}): MemoryInsightQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    async send(message) {
      tail = tail.then(async () => {
        try {
          await handle(message);
        } catch (error) {
          logger.warn("learner insight refresh failed", { userId: message.userId, runId: message.runId, error });
        }
      });
    },
    idle: () => tail,
  };
}

import type { NodeQueueConsumerPort, QueueReceipt } from "../../application/ports/node-queue.port";
import { QUEUE } from "../../config/constants";
import { QuotaExhaustedError } from "../../domain/errors/quota-exhausted.error";
import { TransportUnavailableError } from "../../domain/errors/transport-unavailable.error";
import type { NodeMessage } from "../../domain/schemas/queue-message.schema";
import type { Logger } from "../../shared/logger";

export type LocalQueueWorkerDeps = {
  queue: NodeQueueConsumerPort;
  handle(message: NodeMessage): Promise<void>;
  // Carries the error of the LAST failed attempt: without it the dead-letter path can record THAT a
  // node failed but not WHY, leaving the cause only in this worker's stdout.
  onDeadLetter(message: NodeMessage, error: unknown): Promise<void>;
  // W_expand: the cap on in-flight LLM work, independent of how wide any tree layer is.
  concurrency: number;
  logger: Pick<Logger, "warn" | "error">;
  // Called once when the worker halts itself on an unrecoverable condition. Carries the message it was
  // handling, so the caller can mark that run halted (docs/conflicts.md C55).
  onFatal?(error: unknown, message: NodeMessage): void | Promise<void>;
};

export type LocalQueueWorker = {
  start(): void;
  // Resolves when the queue is empty and nothing is in flight. The deterministic hook for tests and the
  // smoke script - no polling, no fixed waits.
  idle(): Promise<void>;
  // The same predicate, answered NOW. With two passes running at once (C91), one worker going idle
  // proves nothing - construction can still be feeding the article queue - so a caller draining both
  // needs to ask whether they are idle at the same instant, which awaiting cannot tell it.
  isIdle(): boolean;
  stop(): Promise<void>;
};

// Drains the in-memory queue for QUEUE_MODE=memory, with the same redelivery and dead-letter behaviour
// SQS gives the Lambda consumers in Phase 13. Depends on the consumer PORT, never on the memory adapter.
export function createLocalQueueWorker({
  queue,
  handle,
  onDeadLetter,
  concurrency,
  logger,
  onFatal,
}: LocalQueueWorkerDeps): LocalQueueWorker {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(`concurrency must be an integer >= 1, got ${concurrency}`);
  }

  let running = false;
  let halted = false;
  let inFlight = 0;
  let loop: Promise<void> | undefined;
  let stopped!: Promise<void>;
  let releaseStopped!: () => void;
  const slotWaiters: (() => void)[] = [];
  const idleWaiters: (() => void)[] = [];

  const resetStopped = (): void => {
    stopped = new Promise<void>((resolve) => {
      releaseStopped = resolve;
    });
  };
  resetStopped();

  // After a halt the stalled message is deliberately still on the queue (released with countReceive
  // false), so waiting for an empty queue would wait forever. `inFlight` is still honoured, so in-flight
  // siblings finish and their nodes land in the tree before a caller reads it.
  const isIdle = (): boolean => inFlight === 0 && (halted || queue.size() === 0);

  const settleIdle = (): void => {
    if (!isIdle()) return;
    while (idleWaiters.length > 0) idleWaiters.shift()?.();
  };

  // Awaited before the handler releases its slot, so onFatal has finished recording the halt by the time
  // idle() resolves and a caller reads the run. The `finally` below does the real settling.
  const halt = async (error: unknown, message: NodeMessage): Promise<void> => {
    running = false;
    halted = true;
    releaseStopped();
    try {
      await onFatal?.(error, message);
    } catch (fatalError) {
      logger.error("fatal handler failed", { nodeId: message.nodeId, error: fatalError });
    }
  };

  const run = async (receipt: QueueReceipt): Promise<void> => {
    try {
      await handle(receipt.message);
      await queue.delete(receipt.receiptId);
    } catch (error) {
      if (error instanceof QuotaExhaustedError) {
        // A stall, not a failure. Dead-lettering would mark nodes failed for a condition that clears on
        // the provider's reset or a profile switch, and burning MAX_RECEIVES on every node of the
        // frontier would spend the rest of the quota proving the same thing.
        await queue.release(receipt.receiptId, { countReceive: false });
        logger.error("worker halted: LLM daily quota exhausted", { nodeId: receipt.message.nodeId, error });
        await halt(error, receipt.message);
        return;
      }
      // A stall, not a failure, and unlike a daily quota it clears on its own - so the worker keeps
      // running and the node keeps its attempts. Bounded by STALL_MAX_RELEASES: a network that never
      // comes back must still end the run rather than cycle in it, so past the budget this falls through
      // to the counted path below and dead-letters like anything else (docs/conflicts.md C94).
      if (error instanceof TransportUnavailableError && receipt.stallCount < QUEUE.STALL_MAX_RELEASES) {
        await queue.release(receipt.receiptId, {
          countReceive: false,
          delayMs: QUEUE.STALL_DELAY_MS,
        });
        logger.warn("provider unreachable: node returned to the queue", {
          nodeId: receipt.message.nodeId,
          stallCount: receipt.stallCount + 1,
          retryInMs: QUEUE.STALL_DELAY_MS,
          error,
        });
        return;
      }
      logger.warn("node handler failed", {
        nodeId: receipt.message.nodeId,
        receiveCount: receipt.receiveCount,
        stallCount: receipt.stallCount,
        error,
      });
      // receive() counts before delivery, so the first attempt is 1 and the third failure dead-letters -
      // the same arithmetic as an SQS redrive policy with maxReceiveCount: 3.
      if (receipt.receiveCount >= QUEUE.MAX_RECEIVES) {
        await queue.delete(receipt.receiptId);
        try {
          await onDeadLetter(receipt.message, error);
        } catch (dlqError) {
          // Nothing is left to retry with; losing the whole worker here would strand the rest of the tree.
          logger.error("dead-letter handler failed", { nodeId: receipt.message.nodeId, error: dlqError });
        }
      } else {
        await queue.release(receipt.receiptId);
      }
    } finally {
      inFlight -= 1;
      slotWaiters.shift()?.();
      settleIdle();
    }
  };

  const drain = async (): Promise<void> => {
    while (running) {
      if (inFlight >= concurrency) {
        await Promise.race([new Promise<void>((resolve) => slotWaiters.push(resolve)), stopped]);
        continue;
      }
      const [receipt] = await queue.receive(1);
      if (receipt === undefined) {
        settleIdle();
        // Parks until something is enqueued: the reason there are no timers in this loop.
        await Promise.race([queue.waitForMessage(), stopped]);
        continue;
      }
      inFlight += 1;
      void run(receipt);
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      halted = false;
      resetStopped();
      loop = drain();
    },

    idle() {
      if (isIdle()) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },

    isIdle,

    async stop() {
      running = false;
      releaseStopped();
      await loop;
      // In-flight handlers still hold slots; wait them out so a caller can inspect final state.
      while (inFlight > 0) {
        await new Promise<void>((resolve) => slotWaiters.push(resolve));
      }
      settleIdle();
    },
  };
}

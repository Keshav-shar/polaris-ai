import type {
  NodeQueueConsumerPort,
  NodeQueuePort,
  QueueReceipt,
} from "../../application/ports/node-queue.port";
import { QUEUE } from "../../config/constants";
import { NodeMessage } from "../../domain/schemas/queue-message.schema";

export type MemoryNodeQueue = NodeQueuePort & NodeQueueConsumerPort;

type Envelope = { receiptId: string; receiveCount: number; message: NodeMessage };

// The in-process stand-in for an SQS standard queue. It mirrors every condition the real queue enforces
// (receive counting up to QUEUE.MAX_RECEIVES, batch sends chunked at SEND_BATCH_MAX) with ONE deliberate
// exception: there is no visibility timeout. In-process there is no crashed consumer - the worker always
// deletes or releases in a `finally` - and a timer would make every test nondeterministic for no local
// benefit. Phase 13's SQS adapter gets the timeout from the service. (docs/conflicts.md C51.)
export function createMemoryNodeQueue(): MemoryNodeQueue {
  const visible: Envelope[] = [];
  const inFlight = new Map<string, Envelope>();
  const waiters: (() => void)[] = [];
  let nextReceiptId = 0;

  const wake = (): void => {
    while (waiters.length > 0) waiters.shift()?.();
  };

  const enqueue = (message: NodeMessage): void => {
    // The queue is the trust boundary: parsing here is what makes the tree-wide invariants (ancestors <= 2,
    // a valid depth and path on every message) enforceable rather than merely intended.
    visible.push({ receiptId: `r${nextReceiptId++}`, receiveCount: 0, message: NodeMessage.parse(message) });
  };

  return {
    async send(message) {
      enqueue(message);
      wake();
    },

    async sendBatch(messages) {
      // Chunked exactly as SendMessageBatch requires, so the limit is exercised locally too.
      for (let i = 0; i < messages.length; i += QUEUE.SEND_BATCH_MAX) {
        for (const message of messages.slice(i, i + QUEUE.SEND_BATCH_MAX)) enqueue(message);
      }
      wake();
    },

    async receive(max) {
      const taken: QueueReceipt[] = [];
      while (taken.length < max) {
        const envelope = visible.shift();
        if (envelope === undefined) break;
        envelope.receiveCount += 1;
        inFlight.set(envelope.receiptId, envelope);
        taken.push({ ...envelope, message: { ...envelope.message } });
      }
      return taken;
    },

    waitForMessage() {
      if (visible.length > 0) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push(resolve));
    },

    async delete(receiptId) {
      inFlight.delete(receiptId);
    },

    async release(receiptId, options) {
      const envelope = inFlight.get(receiptId);
      if (envelope === undefined) return;
      inFlight.delete(receiptId);
      // countReceive: false rewinds a stall (an exhausted daily quota), which must not push the message
      // towards the dead-letter queue.
      if (options?.countReceive === false) envelope.receiveCount -= 1;
      // Tail, not head: a head push would hot-loop on a poison message and serialise everything behind it.
      visible.push(envelope);
      wake();
    },

    size() {
      return visible.length + inFlight.size;
    },
  };
}

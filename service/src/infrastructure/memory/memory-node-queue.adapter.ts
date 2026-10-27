import type {
  NodeQueueConsumerPort,
  NodeQueuePort,
  QueueReceipt,
} from "../../application/ports/node-queue.port";
import { QUEUE } from "../../config/constants";
import { NodeMessage } from "../../domain/schemas/queue-message.schema";

export type MemoryNodeQueue = NodeQueuePort & NodeQueueConsumerPort;

type Envelope = {
  receiptId: string;
  receiveCount: number;
  // Releases that deliberately did NOT count, i.e. stalls. Carried on the envelope rather than in the
  // consumer, so the consumer stays stateless across deliveries exactly as it is on SQS, where the
  // equivalent number arrives on the message.
  stallCount: number;
  // Epoch ms before which this message is hidden. 0 = visible now.
  visibleAt: number;
  // Arrival order, renewed on every release so a retried message goes behind its peers, never ahead of them.
  seq: number;
  message: NodeMessage;
};

// Injected, never ambient: the delay below is the one piece of time this adapter has, and a test that
// cannot control it is a test that sleeps.
export type MemoryQueueDeps = {
  now?: () => number;
  // setTimeout's shape, returning a cancel. The default is the real timer; `tests/fixtures/fake-clock.ts`
  // supplies a deterministic one.
  schedule?: (ms: number, run: () => void) => () => void;
  // fifo: arrival order. priority (C128): boosted first, then shallower depth, then arrival order - the order
  // composition gives both queues, so a learner's boost and a shallow scroll go ahead of deep ones.
  order?: "fifo" | "priority";
};

const defaultSchedule = (ms: number, run: () => void): (() => void) => {
  const handle = setTimeout(run, ms);
  // Deliberately NOT unref'd. A delayed message is a node still owed an attempt, and a parked consumer
  // has nothing else keeping the loop alive: with the timer unref'd, `npm run smoke:node` exited
  // silently at the first stall and reported nothing. The timer is armed only while a consumer is
  // waiting and cleared as soon as one is woken, so it never outlives real work by more than the delay.
  return () => clearTimeout(handle);
};

// The in-process stand-in for an SQS standard queue. It mirrors the conditions the real queue enforces:
// receive counting up to QUEUE.MAX_RECEIVES, batch sends chunked at SEND_BATCH_MAX, and - since C94 - a
// per-message delay on release, which is SQS's ChangeMessageVisibility. C51 originally left the delay out
// ("a timer would make every test nondeterministic"); the reason it can come back is that both the clock
// and the timer are injected, so determinism is the caller's to keep. There is still no visibility
// timeout on a NORMAL receive: in-process there is no crashed consumer, because the worker always
// deletes or releases in a `finally`.
export function createMemoryNodeQueue({
  now = Date.now,
  schedule = defaultSchedule,
  order = "fifo",
}: MemoryQueueDeps = {}): MemoryNodeQueue {
  const visible: Envelope[] = [];
  const inFlight = new Map<string, Envelope>();
  const waiters: (() => void)[] = [];
  let nextReceiptId = 0;
  let nextSeq = 0;
  let cancelWake: (() => void) | undefined;

  const isDue = (envelope: Envelope): boolean => envelope.visibleAt <= now();

  // True when `a` should be delivered before `b`. A boost always wins, in either order mode.
  const ahead = (a: Envelope, b: Envelope): boolean => {
    const boostA = a.message.boost === true;
    const boostB = b.message.boost === true;
    if (boostA !== boostB) return boostA;
    if (order === "priority" && a.message.depth !== b.message.depth) return a.message.depth < b.message.depth;
    return a.seq < b.seq;
  };

  // The best DUE message, not simply the first: a delayed one stays where it is, untouched.
  const nextDue = (): number => {
    let best = -1;
    for (let i = 0; i < visible.length; i++) {
      const candidate = visible[i];
      if (candidate === undefined || !isDue(candidate)) continue;
      const current = visible[best];
      if (current === undefined || ahead(candidate, current)) best = i;
    }
    return best;
  };

  const wake = (): void => {
    while (waiters.length > 0) waiters.shift()?.();
    // Nobody left to wake: drop the timer rather than let it hold the process open.
    cancelWake?.();
    cancelWake = undefined;
  };

  // Re-arms a single timer on the earliest hidden message, so a parked `waitForMessage()` is released
  // when that message comes due rather than sitting until something else is enqueued.
  const armWake = (): void => {
    cancelWake?.();
    cancelWake = undefined;
    if (waiters.length === 0) return;
    const waits = visible.filter((e) => !isDue(e)).map((e) => e.visibleAt - now());
    if (waits.length === 0) return;
    cancelWake = schedule(Math.max(0, Math.min(...waits)), () => {
      cancelWake = undefined;
      wake();
    });
  };

  const enqueue = (message: NodeMessage): void => {
    // The queue is the trust boundary: parsing here is what makes the tree-wide invariants (ancestors <= 2,
    // a valid depth and path on every message) enforceable rather than merely intended.
    visible.push({
      receiptId: `r${nextReceiptId++}`,
      receiveCount: 0,
      stallCount: 0,
      visibleAt: 0,
      seq: nextSeq++,
      message: NodeMessage.parse(message),
    });
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
        const at = nextDue();
        if (at === -1) break;
        const [envelope] = visible.splice(at, 1);
        if (envelope === undefined) break;
        envelope.receiveCount += 1;
        inFlight.set(envelope.receiptId, envelope);
        taken.push({
          receiptId: envelope.receiptId,
          receiveCount: envelope.receiveCount,
          stallCount: envelope.stallCount,
          message: { ...envelope.message },
        });
      }
      return taken;
    },

    async promote(message) {
      const envelope = visible.find((e) => e.message.pass === message.pass && e.message.nodeId === message.nodeId);
      // In flight or gone: leave it alone. Adding a copy here is exactly what this method must never do.
      if (envelope === undefined) return "not-queued";
      // Its counters and its hidden-until stay as they are: a stalled message is promoted, not un-delayed.
      envelope.message = { ...envelope.message, boost: true };
      if (isDue(envelope)) wake();
      return "promoted";
    },

    waitForMessage() {
      if (visible.some(isDue)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
        armWake();
      });
    },

    async delete(receiptId) {
      inFlight.delete(receiptId);
    },

    async release(receiptId, options) {
      const envelope = inFlight.get(receiptId);
      if (envelope === undefined) return;
      inFlight.delete(receiptId);
      // countReceive: false rewinds a stall (an exhausted daily quota, an unreachable provider), which
      // must not push the message towards the dead-letter queue.
      if (options?.countReceive === false) {
        envelope.receiveCount -= 1;
        envelope.stallCount += 1;
      }
      const delayMs = options?.delayMs ?? 0;
      envelope.visibleAt = delayMs > 0 ? now() + delayMs : 0;
      envelope.seq = nextSeq++;
      // Tail, not head: a head push would hot-loop on a poison message and serialise everything behind it.
      visible.push(envelope);
      if (delayMs > 0) armWake();
      else wake();
    },

    size() {
      return visible.length + inFlight.size;
    },
  };
}

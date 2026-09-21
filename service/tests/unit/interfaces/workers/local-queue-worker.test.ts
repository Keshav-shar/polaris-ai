import { describe, expect, it, vi } from "vitest";
import { rootConstructMessage } from "../../../../src/application/tree/messages";
import { QUEUE } from "../../../../src/config/constants";
import { QuotaExhaustedError } from "../../../../src/domain/errors/quota-exhausted.error";
import type { NodeMessage } from "../../../../src/domain/schemas/queue-message.schema";
import { createMemoryNodeQueue } from "../../../../src/infrastructure/memory/memory-node-queue.adapter";
import { createLocalQueueWorker } from "../../../../src/interfaces/workers/local-queue-worker";
import { fakeLogger } from "../../../fixtures/fake-generate";

const runId = "11111111-1111-4111-8111-111111111111";
const message = rootConstructMessage(runId, { topic: "photosynthesis", maxDepth: 1 });

function setup(handle: (m: NodeMessage) => Promise<void>, concurrency = 2) {
  const queue = createMemoryNodeQueue();
  const { logger, warnings } = fakeLogger();
  const deadLettered: NodeMessage[] = [];
  const fatals: unknown[] = [];
  const worker = createLocalQueueWorker({
    queue,
    handle,
    onDeadLetter: async (m) => void deadLettered.push(m),
    concurrency,
    logger: { ...logger, error: (msg, context) => void warnings.push({ msg, context }) },
    onFatal: (error) => void fatals.push(error),
  });
  return { queue, worker, deadLettered, fatals, warnings };
}

describe("local queue worker", () => {
  it("handles a message and deletes it", async () => {
    const handled: NodeMessage[] = [];
    const { queue, worker } = setup(async (m) => void handled.push(m));
    await queue.send(message);
    worker.start();
    await worker.idle();
    await worker.stop();
    expect(handled).toHaveLength(1);
    expect(queue.size()).toBe(0);
  });

  it("redelivers a failing message and succeeds on a later attempt", async () => {
    let attempts = 0;
    const { queue, worker, deadLettered } = setup(async () => {
      attempts++;
      if (attempts < QUEUE.MAX_RECEIVES) throw new Error("transient");
    });
    await queue.send(message);
    worker.start();
    await worker.idle();
    await worker.stop();
    expect(attempts).toBe(QUEUE.MAX_RECEIVES);
    expect(deadLettered).toHaveLength(0);
    expect(queue.size()).toBe(0);
  });

  it("dead-letters after QUEUE.MAX_RECEIVES failures and stops redelivering", async () => {
    let attempts = 0;
    const { queue, worker, deadLettered } = setup(async () => {
      attempts++;
      throw new Error("always fails");
    });
    await queue.send(message);
    worker.start();
    await worker.idle();
    await worker.stop();
    expect(attempts).toBe(QUEUE.MAX_RECEIVES);
    expect(deadLettered).toEqual([message]);
    expect(queue.size()).toBe(0);
  });

  it("halts on an exhausted daily quota without burning receives", async () => {
    let attempts = 0;
    const { queue, worker, deadLettered, fatals } = setup(async () => {
      attempts++;
      throw new QuotaExhaustedError("gemini-3.6-flash");
    });
    await queue.send(message);
    worker.start();
    await worker.stop();

    // One attempt only: retrying would spend the rest of a quota that resets tomorrow.
    expect(attempts).toBe(1);
    expect(deadLettered).toEqual([]);
    expect(fatals[0]).toBeInstanceOf(QuotaExhaustedError);
    // The message is still queued, and its receive count was rewound, so a restart resumes cleanly.
    expect(queue.size()).toBe(1);
    const [receipt] = await queue.receive(1);
    expect(receipt?.receiveCount).toBe(1);
  });

  it("lets idle() resolve after a halt, so a caller can still read what was built", async () => {
    // The halted message is deliberately left on the queue, so waiting for an empty queue waited
    // forever: smoke:node hung on idle() and never printed the partial tree it already had.
    const { queue, worker } = setup(async () => {
      throw new QuotaExhaustedError("gemini-3.6-flash");
    });
    await queue.send(message);
    worker.start();

    await expect(worker.idle()).resolves.toBeUndefined();
    expect(queue.size()).toBe(1);
    await worker.stop();
  });

  it("gives onFatal the message it halted on, so the right run is marked", async () => {
    const seen: NodeMessage[] = [];
    const queue = createMemoryNodeQueue();
    const { logger, warnings } = fakeLogger();
    const worker = createLocalQueueWorker({
      queue,
      handle: async () => {
        throw new QuotaExhaustedError("gemini-3.6-flash");
      },
      onDeadLetter: async () => {},
      concurrency: 1,
      logger: { ...logger, error: (msg, context) => void warnings.push({ msg, context }) },
      onFatal: (_error, m) => void seen.push(m),
    });
    await queue.send(message);
    worker.start();
    await worker.idle();
    await worker.stop();

    expect(seen).toEqual([message]);
    expect(seen[0]?.runId).toBe(runId);
  });

  it("never exceeds its concurrency", async () => {
    let active = 0;
    let peak = 0;
    const { queue, worker } = setup(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
    }, 2);
    await queue.sendBatch(
      Array.from({ length: 8 }, (_, i) => ({
        ...message,
        nodeId: `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`,
      })),
    );
    worker.start();
    await worker.idle();
    await worker.stop();
    expect(peak).toBe(2);
  });

  it("keeps working when the dead-letter handler itself fails", async () => {
    const queue = createMemoryNodeQueue();
    const { logger, warnings } = fakeLogger();
    const worker = createLocalQueueWorker({
      queue,
      handle: async () => {
        throw new Error("always fails");
      },
      onDeadLetter: async () => {
        throw new Error("dlq is down");
      },
      concurrency: 1,
      logger: { ...logger, error: (msg, context) => void warnings.push({ msg, context }) },
    });
    await queue.send(message);
    worker.start();
    await worker.idle();
    await worker.stop();
    // Losing the worker here would strand every other node in the tree.
    expect(warnings.map((w) => w.msg)).toContain("dead-letter handler failed");
    expect(queue.size()).toBe(0);
  });

  it("idle() resolves immediately when there is nothing to do, and start/stop are idempotent", async () => {
    const { worker } = setup(async () => {});
    await expect(worker.idle()).resolves.toBeUndefined();
    worker.start();
    worker.start();
    await worker.stop();
    await expect(worker.stop()).resolves.toBeUndefined();
  });

  it("rejects a concurrency that is not a positive integer", () => {
    expect(() => setup(async () => {}, 0)).toThrow(RangeError);
  });

  it("uses no timers: the drain loop parks on the queue instead of polling", async () => {
    vi.useFakeTimers();
    try {
      const { queue, worker } = setup(async () => {});
      worker.start();
      // With the worker running but idle, nothing is scheduled - a polling loop would have a pending timer.
      expect(vi.getTimerCount()).toBe(0);
      await queue.send(message);
      await worker.idle();
      await worker.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

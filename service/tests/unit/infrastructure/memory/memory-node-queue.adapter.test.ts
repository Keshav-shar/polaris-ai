import { describe, expect, it } from "vitest";
import { rootConstructMessage } from "../../../../src/application/tree/messages";
import { QUEUE } from "../../../../src/config/constants";
import { createMemoryNodeQueue } from "../../../../src/infrastructure/memory/memory-node-queue.adapter";

const runId = "11111111-1111-4111-8111-111111111111";
const message = rootConstructMessage(runId, { topic: "photosynthesis", maxDepth: 2 });

describe("memory node queue", () => {
  it("counts receives from 1, so the third failure is the dead-letter point", async () => {
    const queue = createMemoryNodeQueue();
    await queue.send(message);
    for (let expected = 1; expected <= QUEUE.MAX_RECEIVES; expected++) {
      const [receipt] = await queue.receive(1);
      expect(receipt?.receiveCount).toBe(expected);
      await queue.release(receipt!.receiptId);
    }
  });

  it("rewinds the count when a release is a stall rather than a failure", async () => {
    const queue = createMemoryNodeQueue();
    await queue.send(message);
    const [first] = await queue.receive(1);
    await queue.release(first!.receiptId, { countReceive: false });
    const [second] = await queue.receive(1);
    // A quota stall must not push the message towards the DLQ.
    expect(second?.receiveCount).toBe(1);
  });

  it("releases to the tail, so a failing message cannot starve the others", async () => {
    const queue = createMemoryNodeQueue();
    const other = { ...message, nodeId: "22222222-2222-4222-8222-222222222222", topic: "other" };
    await queue.sendBatch([message, other]);
    const [first] = await queue.receive(1);
    await queue.release(first!.receiptId);
    const [next] = await queue.receive(1);
    expect(next?.message.topic).toBe("other");
  });

  it("delete removes the message for good", async () => {
    const queue = createMemoryNodeQueue();
    await queue.send(message);
    const [receipt] = await queue.receive(1);
    expect(queue.size()).toBe(1); // in flight still counts
    await queue.delete(receipt!.receiptId);
    expect(queue.size()).toBe(0);
    expect(await queue.receive(1)).toEqual([]);
  });

  it("waitForMessage resolves immediately when work is waiting, and on the next send otherwise", async () => {
    const queue = createMemoryNodeQueue();
    await queue.send(message);
    await expect(queue.waitForMessage()).resolves.toBeUndefined();

    const [receipt] = await queue.receive(1);
    await queue.delete(receipt!.receiptId);
    let woke = false;
    const parked = queue.waitForMessage().then(() => {
      woke = true;
    });
    expect(woke).toBe(false);
    await queue.send(message);
    await parked;
    expect(woke).toBe(true);
  });

  it("sends a batch larger than the SQS limit by chunking it", async () => {
    const queue = createMemoryNodeQueue();
    const many = Array.from({ length: QUEUE.SEND_BATCH_MAX * 2 + 3 }, (_, i) => ({
      ...message,
      nodeId: `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`,
    }));
    await queue.sendBatch(many);
    expect(queue.size()).toBe(many.length);
  });

  it("rejects a message that violates the contract, because the queue is the trust boundary", async () => {
    const queue = createMemoryNodeQueue();
    const tooManyAncestors = {
      ...message,
      ancestors: [1, 2, 3].map((n) => ({ depth: n, topic: `t${n}`, brief: `b${n}` })),
    };
    await expect(queue.send(tooManyAncestors)).rejects.toThrow();
    await expect(queue.send({ ...message, depth: -1 })).rejects.toThrow();
  });
});

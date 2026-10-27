import { describe, expect, it } from "vitest";
import { createLimiter, createPriorityLimiter } from "../../../../src/infrastructure/llm/concurrency";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createLimiter", () => {
  it("never runs more than n tasks at once and starts waiters in FIFO order", async () => {
    const limit = createLimiter(2);
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];
    let active = 0;
    let peak = 0;

    const runs = gates.map((gate, i) =>
      limit(async () => {
        started.push(i);
        active++;
        peak = Math.max(peak, active);
        await gate.promise;
        active--;
      }),
    );

    await tick();
    expect(started).toEqual([0, 1]);
    gates[1]!.resolve();
    await tick();
    expect(started).toEqual([0, 1, 2]);
    for (const gate of gates) gate.resolve();
    await Promise.all(runs);
    expect(started).toEqual([0, 1, 2, 3]);
    expect(peak).toBe(2);
  });

  it("propagates a rejection and frees the slot", async () => {
    const limit = createLimiter(1);
    await expect(limit(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(limit(() => Promise.resolve("next"))).resolves.toBe("next");
  });

  it("rejects sizes below 1 and non-integers", () => {
    expect(() => createLimiter(0)).toThrow(RangeError);
    expect(() => createLimiter(1.5)).toThrow(RangeError);
  });
});

describe("createPriorityLimiter (C129)", () => {
  it("hands a freed slot to the best-ranked waiter, then by depth, then in arrival order", async () => {
    const limit = createPriorityLimiter(1);
    const gate = deferred();
    const started: string[] = [];
    const run = (name: string, priority: number[]) =>
      limit(priority, async () => {
        started.push(name);
        if (name === "first") await gate.promise;
      });

    const runs = [
      run("first", [2, 0]),
      run("article-d2", [2, 2]),
      run("article-d1", [2, 1]),
      run("expand-d3", [1, 3]),
      run("expand-d3-later", [1, 3]),
      run("boosted", [0, 5]),
    ];
    await tick();
    expect(started).toEqual(["first"]);
    gate.resolve();
    await Promise.all(runs);
    expect(started).toEqual(["first", "boosted", "expand-d3", "expand-d3-later", "article-d1", "article-d2"]);
  });

  it("never runs more than n at once and frees the slot when a task throws", async () => {
    const limit = createPriorityLimiter(2);
    let active = 0;
    let peak = 0;
    const task = (fail: boolean) => async () => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
      if (fail) throw new Error("boom");
    };
    const results = await Promise.allSettled([0, 1, 2, 3, 4].map((i) => limit([i % 2], task(i === 0))));
    expect(peak).toBe(2);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("rejects a size that is not a positive integer", () => {
    expect(() => createPriorityLimiter(0)).toThrow(RangeError);
    expect(() => createPriorityLimiter(1.5)).toThrow(RangeError);
  });
});

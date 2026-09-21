import { describe, expect, it } from "vitest";
import { createLimiter } from "../../../../src/infrastructure/llm/concurrency";

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

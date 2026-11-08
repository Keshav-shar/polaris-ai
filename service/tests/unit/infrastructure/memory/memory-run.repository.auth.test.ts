import { describe, expect, it } from "vitest";
import { createMemoryRunRepository } from "../../../../src/infrastructure/memory/memory-run.repository";
import { createMemoryUsageStore } from "../../../../src/infrastructure/memory/memory-usage.store";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("memory run repository: ownership and retention", () => {
  it("prunes only the owner's oldest PRIVATE FINISHED runs beyond `keep`", async () => {
    const repo = createMemoryRunRepository();
    await repo.create({ runId: id(1), topic: "a", maxDepth: 1, status: "done", ownerId: owner, visibility: "private" });
    await repo.create({ runId: id(2), topic: "b", maxDepth: 1, status: "done", ownerId: owner, visibility: "public" });
    await repo.create({ runId: id(3), topic: "c", maxDepth: 1, status: "constructing", ownerId: owner, visibility: "private" });
    await repo.create({ runId: id(4), topic: "d", maxDepth: 1, status: "failed", ownerId: owner, visibility: "private" });

    expect(await repo.pruneForOwner(owner, 1)).toBe(1);
    // Kept: the newest private finished run (4), the shared one (2) and the one still building (3).
    expect((await repo.listByOwner(owner, 10)).map((r) => r.runId)).toEqual([id(4), id(3), id(2)]);
  });

  it("halts every run a dead process left building, and nothing else", async () => {
    const repo = createMemoryRunRepository();
    await repo.create({ runId: id(1), topic: "a", maxDepth: 1, status: "constructing" });
    await repo.create({ runId: id(2), topic: "b", maxDepth: 1, status: "constructed" });
    await repo.create({ runId: id(3), topic: "c", maxDepth: 1, status: "done" });
    expect(await repo.haltInterrupted("restarted")).toBe(2);
    expect(await repo.get(id(1))).toMatchObject({ status: "halted", haltReason: "restarted" });
    expect(await repo.get(id(3))).toMatchObject({ status: "done" });
    expect(await repo.countActive()).toBe(0);
  });
});

describe("memory usage store", () => {
  it("allows `limit` per UTC day, counts no refusal, and resets the next day", async () => {
    let now = Date.UTC(2026, 10, 1, 23, 0);
    const usage = createMemoryUsageStore({ now: () => now });
    expect(await usage.reserveRun(owner, 1)).toBe(true);
    expect(await usage.reserveRun(owner, 1)).toBe(false);
    now = Date.UTC(2026, 10, 2, 0, 1);
    expect(await usage.reserveRun(owner, 1)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { createMemoryRunStateStore } from "../../../../src/infrastructure/memory/memory-run-state.store";
import { createMemoryRunRepository } from "../../../../src/infrastructure/memory/memory-run.repository";

const runId = "11111111-1111-4111-8111-111111111111";

describe("memory run state store: reserveNodes", () => {
  const runId = "11111111-1111-4111-8111-111111111111";

  it("grants what fits and refuses the rest, counting the refusal", async () => {
    // The root already occupies one slot, so a cap of 5 leaves 4 for children.
    const store = createMemoryRunStateStore(5);
    expect(await store.reserveNodes(runId, 3)).toBe(3);
    expect(await store.reserveNodes(runId, 3)).toBe(1);
    expect(await store.reserveNodes(runId, 3)).toBe(0);
    expect(await store.get(runId)).toMatchObject({ nodesCreated: 5, nodesSkipped: 5 });
  });

  // C101: the balanced branch cap is passed as `limit`; what it refuses is skipped like a budget refusal.
  it("grants at most `limit` and counts everything over it as skipped", async () => {
    const store = createMemoryRunStateStore(100);
    expect(await store.reserveNodes(runId, 5, 2)).toBe(2);
    expect(await store.get(runId)).toMatchObject({ nodesCreated: 3, nodesSkipped: 3 });
    // The budget still binds below the limit.
    const tight = createMemoryRunStateStore(2);
    expect(await tight.reserveNodes(runId, 5, 3)).toBe(1);
    expect(await tight.get(runId)).toMatchObject({ nodesCreated: 2, nodesSkipped: 4 });
  });

  it("counts the root, so the cap is the TOTAL node count and not children only", async () => {
    const store = createMemoryRunStateStore(4);
    expect(await store.reserveNodes(runId, 10)).toBe(3);
  });

  it("keeps runs apart", async () => {
    const store = createMemoryRunStateStore(3);
    const other = "22222222-2222-4222-8222-222222222222";
    expect(await store.reserveNodes(runId, 2)).toBe(2);
    expect(await store.reserveNodes(other, 2)).toBe(2);
  });

  it("is a no-op for a leaf asking for nothing", async () => {
    const store = createMemoryRunStateStore(10);
    expect(await store.reserveNodes(runId, 0)).toBe(0);
    expect(await store.get(runId)).toMatchObject({ nodesCreated: 1, nodesSkipped: 0 });
  });

  it("rejects a nonsensical request rather than silently granting it", async () => {
    const store = createMemoryRunStateStore(10);
    await expect(store.reserveNodes(runId, -1)).rejects.toThrow(RangeError);
  });
});

describe("memory run state store", () => {
  it("creates the counters on first use and accumulates", async () => {
    const store = createMemoryRunStateStore();
    expect(await store.get(runId)).toBeUndefined();
    expect((await store.countNode(runId, "done")).nodesDone).toBe(1);
    await store.countNode(runId, "done");
    const state = await store.countNode(runId, "failed");
    expect(state).toMatchObject({ nodesDone: 2, nodesFailed: 1, articlesDone: 0, articlesFailed: 0 });
  });

  it("returns a copy", async () => {
    const store = createMemoryRunStateStore();
    const first = await store.countNode(runId, "done");
    first.nodesDone = 99;
    expect((await store.get(runId))?.nodesDone).toBe(1);
  });
});

describe("memory run repository", () => {
  it("stores, updates the status and copies on read", async () => {
    const repo = createMemoryRunRepository();
    expect(await repo.get(runId)).toBeUndefined();
    await repo.create({ runId, topic: "photosynthesis", maxDepth: 2, status: "constructing" });
    await repo.setStatus(runId, "constructed");
    const run = await repo.get(runId);
    expect(run).toMatchObject({ topic: "photosynthesis", status: "constructed" });
    run!.status = "failed";
    expect((await repo.get(runId))?.status).toBe("constructed");
  });

  it("ignores a status update for a run that does not exist", async () => {
    const repo = createMemoryRunRepository();
    await expect(repo.setStatus("missing", "done")).resolves.toBeUndefined();
  });
});

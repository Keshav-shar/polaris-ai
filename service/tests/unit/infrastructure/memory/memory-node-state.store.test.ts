import { beforeEach, describe, expect, it } from "vitest";
import type { NodeStatePort } from "../../../../src/application/ports/node-state.port";
import { rootConstructMessage, childConstructMessage } from "../../../../src/application/tree/messages";
import { createMemoryNodeStateStore } from "../../../../src/infrastructure/memory/memory-node-state.store";

const runId = "11111111-1111-4111-8111-111111111111";
const root = rootConstructMessage(runId, { topic: "photosynthesis", maxDepth: 2, request: "photosynthesis" });
const claimRoot = { runId, nodeId: root.nodeId, parentId: null, depth: 0 };

describe("memory node state store", () => {
  let store: NodeStatePort;
  beforeEach(() => {
    store = createMemoryNodeStateStore();
  });

  it("rule 1: a finished node is returned untouched, so a duplicate delivery is a no-op", async () => {
    await store.claim(claimRoot);
    await store.finish(root.nodeId, "done");
    const again = await store.claim(claimRoot);
    expect(again.status).toBe("done");
    // attempts is NOT bumped: the caller returns immediately and nothing is re-run.
    expect(again.attempts).toBe(1);
  });

  it("counts attempts across redeliveries of an unfinished node", async () => {
    expect((await store.claim(claimRoot)).attempts).toBe(1);
    expect((await store.claim(claimRoot)).attempts).toBe(2);
    expect((await store.claim(claimRoot)).status).toBe("in_progress");
  });

  it("rule 3: result, expectedChildren and status are written together", async () => {
    await store.claim(claimRoot);
    const saved = await store.saveResult(root.nodeId, { brief: "b", children: [{ topic: "a", brief: "b" }, { topic: "b", brief: "b" }, { topic: "c", brief: "b" }] });
    expect(saved.status).toBe("expanded");
    expect(saved.expectedChildren).toBe(3);
    expect(saved.result).toEqual({ brief: "b", children: [{ topic: "a", brief: "b" }, { topic: "b", brief: "b" }, { topic: "c", brief: "b" }] });
  });

  it("rule 2: an existing result is reused, never overwritten", async () => {
    await store.claim(claimRoot);
    await store.saveResult(root.nodeId, { brief: "first", children: [{ topic: "a", brief: "b" }] });
    const second = await store.saveResult(root.nodeId, { brief: "second", children: [{ topic: "x", brief: "b" }, { topic: "y", brief: "b" }] });
    // The stored value wins, so two deliveries can never disagree about the child set.
    expect(second.result).toEqual({ brief: "first", children: [{ topic: "a", brief: "b" }] });
    expect(second.expectedChildren).toBe(1);
  });

  it("rule 4: createPending never disturbs an existing node", async () => {
    const child = childConstructMessage(root, "b", { topic: "light reactions", brief: "child brief" });
    await store.createPending([child]);
    await store.claim({ runId, nodeId: child.nodeId, parentId: root.nodeId, depth: 1 });
    await store.saveResult(child.nodeId, { brief: "b", children: [] });
    // A retried parent re-creates its children; the already-expanded one must survive intact.
    await store.createPending([child]);
    const state = await store.claim({ runId, nodeId: child.nodeId, parentId: root.nodeId, depth: 1 });
    expect(state.result).toEqual({ brief: "b", children: [] });
  });

  it("finish is conditional: the second call resolves undefined", async () => {
    await store.claim(claimRoot);
    expect(await store.finish(root.nodeId, "done")).toBeDefined();
    expect(await store.finish(root.nodeId, "done")).toBeUndefined();
    expect(await store.finish(root.nodeId, "failed")).toBeUndefined();
    expect(await store.finish("22222222-2222-4222-8222-222222222222", "done")).toBeUndefined();
  });

  it("rule 5: a child is counted exactly once, whatever its outcome", async () => {
    await store.claim(claimRoot);
    await store.saveResult(root.nodeId, { brief: "b", children: [{ topic: "a", brief: "b" }, { topic: "b", brief: "b" }] });
    const first = await store.recordChildCompletion(root.nodeId, "child-1", "done");
    expect(first?.completedChildren).toBe(1);
    // A redelivered completion must not advance the counter.
    expect(await store.recordChildCompletion(root.nodeId, "child-1", "done")).toBeUndefined();
    const failed = await store.recordChildCompletion(root.nodeId, "child-2", "failed");
    // A failed child still completes its parent - that is what stops a failed branch hanging the tree.
    expect(failed?.completedChildren).toBe(2);
    expect(failed?.failedChildren).toBe(1);
  });

  it("returns copies, so a caller cannot mutate stored state", async () => {
    await store.claim(claimRoot);
    await store.saveResult(root.nodeId, { brief: "b", children: [{ topic: "a", brief: "b" }] });
    const state = await store.recordChildCompletion(root.nodeId, "child-1", "done");
    state?.completedChildIds.push("forged");
    const fresh = await store.recordChildCompletion(root.nodeId, "child-2", "done");
    expect(fresh?.completedChildIds).toEqual(["child-1", "child-2"]);
  });

  it("throws when saveResult targets a node that was never claimed", async () => {
    await expect(store.saveResult(root.nodeId, { brief: "b", children: [] })).rejects.toThrow(/does not exist/);
  });
});

describe("memory node state store, boost (C128)", () => {
  it("records a boost on an existing node, idempotently, and reports a missing one", async () => {
    const store = createMemoryNodeStateStore();
    await expect(store.markBoosted(root.nodeId)).resolves.toBe(false);
    await store.claim(claimRoot);
    await expect(store.markBoosted(root.nodeId)).resolves.toBe(true);
    await expect(store.markBoosted(root.nodeId)).resolves.toBe(true);
    expect((await store.claim(claimRoot)).boosted).toBe(true);
  });
});

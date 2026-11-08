import { describe, expect, it } from "vitest";
import { ARTICLE } from "../../../../src/config/constants";
import { ArticleLeaseHeldError } from "../../../../src/domain/errors/article-lease-held.error";
import { statsFromTree } from "../../../../src/domain/entities/tree-stats";
import type { TreeNode } from "../../../../src/domain/schemas/node.schema";
import { createMemoryNodeStateStore } from "../../../../src/infrastructure/memory/memory-node-state.store";
import { createMemoryRunStateStore } from "../../../../src/infrastructure/memory/memory-run-state.store";

const runId = "11111111-1111-4111-8111-111111111111";
const nodeId = "22222222-2222-4222-8222-222222222222";

async function claimed() {
  const store = createMemoryNodeStateStore();
  await store.claim({ runId, nodeId, parentId: null, depth: 0 });
  return store;
}

describe("article claim lease (A18, C142) - the memory twin of the DynamoDB condition", () => {
  it("a second claimant inside a live lease is refused, with the time left", async () => {
    const store = await claimed();
    await store.claimArticle(nodeId, { claimant: "a", nowMs: 0 });
    await expect(store.claimArticle(nodeId, { claimant: "b", nowMs: 1_000 })).rejects.toEqual(
      new ArticleLeaseHeldError(nodeId, ARTICLE.CLAIM_LEASE_MS - 1_000),
    );
  });

  it("the same claimant (its own redelivery) always gets the claim back", async () => {
    const store = await claimed();
    await store.claimArticle(nodeId, { claimant: "a", nowMs: 0 });
    await expect(store.claimArticle(nodeId, { claimant: "a", nowMs: 5_000 })).resolves.toMatchObject({ claimedBy: "a" });
  });

  it("an expired lease can be taken over - a crashed attempt is not waited on forever", async () => {
    const store = await claimed();
    await store.claimArticle(nodeId, { claimant: "a", nowMs: 0 });
    await expect(store.claimArticle(nodeId, { claimant: "b", nowMs: ARTICLE.CLAIM_LEASE_MS + 1 })).resolves.toMatchObject({
      claimedBy: "b",
    });
  });

  it("a finished article is returned to anyone, lease or not; no lease means no check", async () => {
    const store = await claimed();
    await store.claimArticle(nodeId, { claimant: "a", nowMs: 0 });
    await expect(store.claimArticle(nodeId)).resolves.toMatchObject({ articleStatus: "in_progress" });
    await store.finishArticle(nodeId, "done");
    await expect(store.claimArticle(nodeId, { claimant: "b", nowMs: 1 })).resolves.toMatchObject({ articleStatus: "done" });
  });

  it("A17: the last failure reason is kept on the node", async () => {
    const store = await claimed();
    await store.recordError(nodeId, "Error: first");
    await store.recordError(nodeId, "Error: second");
    await expect(store.lastError(nodeId)).resolves.toBe("Error: second");
  });

  it("A16: the first halt time wins", async () => {
    const runs = createMemoryRunStateStore();
    await runs.halt(runId, 5);
    await runs.halt(runId, 9);
    await expect(runs.get(runId)).resolves.toMatchObject({ haltedAt: 5 });
  });
});

describe("statsFromTree (A19, C141)", () => {
  const node = (status: TreeNode["status"], articleStatus?: "done" | "failed", children: TreeNode[] = []): TreeNode =>
    ({ id: nodeId, topic: "t", depth: 0, brief: "", status, children, ...(articleStatus ? { articleStatus } : {}) }) as TreeNode;

  it("counts node and article outcomes over the whole tree", () => {
    const tree = node("done", "done", [node("done", "failed"), node("failed"), node("pending", undefined, [node("done", "done")])]);
    expect(statsFromTree(tree, 2)).toEqual({ nodesDone: 3, nodesFailed: 1, nodesSkipped: 2, articlesDone: 2, articlesFailed: 1 });
  });

  it("is all zeros for an empty run", () => {
    expect(statsFromTree(null, 0)).toEqual({ nodesDone: 0, nodesFailed: 0, nodesSkipped: 0, articlesDone: 0, articlesFailed: 0 });
  });
});

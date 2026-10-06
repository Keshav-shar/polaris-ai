import { describe, expect, it } from "vitest";
import { rootConstructMessage } from "../../../../src/application/tree/messages";
import { buildHarness } from "../../../fixtures/build-harness";

const runId = "11111111-1111-4111-8111-111111111111";
const rootOf = (maxDepth: number) => rootConstructMessage(runId, { topic: "photosynthesis", maxDepth });

describe("expand-node use-case", () => {
  it("expands a node, stores it and enqueues its children", async () => {
    const h = buildHarness({ breadth: 3 });
    const root = rootOf(2);
    await h.expandNode.execute(root);

    expect((await h.treeRepo.getTree(runId))?.brief).toBe("brief for photosynthesis");
    // Children are on the queue, and their state exists before the messages went out (rule 4 + 3).
    expect(h.queue.size()).toBe(3);
    const child = (await h.queue.receive(1))[0]!.message;
    expect(child.depth).toBe(1);
    expect(child.ancestors).toEqual([{ depth: 0, topic: "photosynthesis", brief: "brief for photosynthesis" }]);
  });

  it("writes the node's row before expanding it, and its children's rows once they are known", async () => {
    // Order matters: a node whose expansion 429s must still be in the tree under its known topic, or a
    // run that stops early has nothing at all to show (docs/conflicts.md C54).
    const h = buildHarness({ breadth: 2 });
    const root = rootOf(2);
    await h.expandNode.execute(root);

    const tree = await h.treeRepo.getTree(runId);
    expect(tree).toMatchObject({ topic: "photosynthesis", status: "expanded" });
    expect(tree?.children.map((c) => c.topic)).toEqual(["photosynthesis 1", "photosynthesis 2"]);
    // The children are known but untouched: listed, with no brief and nothing claimed yet.
    expect(tree?.children.every((c) => c.status === "pending" && c.brief === "")).toBe(true);
  });

  it("rule 6: re-delivering a node does not undo the rows already written for it", async () => {
    const h = buildHarness({ breadth: 2 });
    const root = rootOf(2);
    await h.expandNode.execute(root);
    await h.expandNode.execute(root);

    const tree = await h.treeRepo.getTree(runId);
    expect(tree).toMatchObject({ status: "expanded", brief: "brief for photosynthesis" });
    expect(tree?.children).toHaveLength(2);
  });

  it("rule 1: a duplicate delivery of a finished node does nothing", async () => {
    const h = buildHarness({ maxDepth: 1 });
    const root = rootOf(1);
    await h.expandNode.execute(root);
    await h.fanIn.completeConstruction(root.nodeId, "done");

    const callsBefore = h.expander.calls.length;
    const sizeBefore = h.queue.size();
    await h.expandNode.execute(root);
    expect(h.expander.calls.length).toBe(callsBefore);
    expect(h.queue.size()).toBe(sizeBefore);
  });

  it("rule 2: a redelivery after generation reuses the stored result - no second LLM call, same child ids", async () => {
    const h = buildHarness({ breadth: 3 });
    const root = rootOf(2);
    await h.expandNode.execute(root);
    const firstIds = (await h.queue.receive(10)).map((r) => r.message.nodeId);

    // Simulate a crash after the result was saved but before the caller acknowledged the message.
    await h.expandNode.execute(root);
    expect(h.expander.countFor("photosynthesis")).toBe(1);
    const secondIds = (await h.queue.receive(10)).map((r) => r.message.nodeId);
    expect(secondIds).toEqual(firstIds);
  });

  it("rule 7: a retried parent keeps its own dedup claims", async () => {
    const h = buildHarness({ breadth: 3 });
    const root = rootOf(2);
    await h.expandNode.execute(root);
    const first = (await h.queue.receive(10)).map((r) => r.message.topic);
    expect(first).toHaveLength(3);

    // Even with the stored result cleared, the same parent re-claiming must not starve itself.
    const reclaimed = await h.dedup.claimTopics(runId, root.nodeId, first);
    expect(reclaimed).toEqual(first);
  });

  it("dedups a topic across branches, so it is expanded once for the whole run", async () => {
    // Both children propose the same grandchild; only the first branch keeps it.
    const h = buildHarness({
      maxDepth: 3,
      childrenFor: (topic) => (topic === "photosynthesis" ? ["branch a", "branch b"] : ["shared topic"]),
    });
    const runIdBuilt = await h.build("photosynthesis");
    expect(h.expander.countFor("shared topic")).toBe(1);
    const tree = await h.getTree.execute(runIdBuilt);
    const sharedParents = tree.tree!.children.filter((c) => c.children.length > 0);
    expect(sharedParents).toHaveLength(1);
  });

  it("completes immediately at a leaf and never claims topics there", async () => {
    const h = buildHarness();
    // maxDepth 1 makes the root a taper node and depth 1 the leaf layer.
    const root = rootOf(1);
    await h.expandNode.execute(root);
    const [child] = await h.queue.receive(1);
    await h.expandNode.execute(child!.message);

    const state = await h.nodeState.claim({
      runId,
      nodeId: child!.message.nodeId,
      parentId: root.nodeId,
      depth: 1,
    });
    expect(state.status).toBe("done");
    expect(state.result?.children).toEqual([]);
  });

  it("stores the result before sending children, so a fast child can always be counted", async () => {
    const h = buildHarness({ breadth: 2 });
    const root = rootOf(2);
    await h.expandNode.execute(root);
    const parent = await h.nodeState.claim({ runId, nodeId: root.nodeId, parentId: null, depth: 0 });
    // expectedChildren is already set even though no child has run yet (rule 3).
    expect(parent.expectedChildren).toBe(2);
    expect(parent.result?.children).toHaveLength(2);
  });

  it("lets an expander failure propagate, so the worker can redeliver", async () => {
    const h = buildHarness({ failTimes: { photosynthesis: 1 } });
    await expect(h.expandNode.execute(rootOf(2))).rejects.toThrow(/fake expander failure/);
  });

  it("hands the node to the article pass as soon as it is expanded (C91)", async () => {
    // The whole point of the change: one downward traversal. The node's scroll is queued while its
    // children have not been expanded yet - not after the fan-in has climbed back to the root.
    const h = buildHarness({ breadth: 3 });
    const root = rootOf(2);
    await h.expandNode.execute(root);

    const [article] = await h.articleQueue.receive(1);
    expect(article?.message).toMatchObject({ pass: "article", nodeId: root.nodeId, topic: "photosynthesis" });
    // Its children are still only queued for construction, so nothing below it exists yet.
    expect(h.queue.size()).toBe(3);
    expect((await h.runState.get(runId))?.nodesDone ?? 0).toBe(0);
  });

  it("puts the children's rows on the tree BEFORE the article message, so the writer can signpost", async () => {
    // Ordering, not decoration: the writer reads the child rows to name this node's subtopics, and an
    // article message that overtook upsertPending would find none and write the node as a leaf.
    const h = buildHarness({ breadth: 2 });
    await h.expandNode.execute(rootOf(2));

    const [article] = await h.articleQueue.receive(1);
    const node = await h.treeRepo.getNode(article!.message.nodeId);
    expect(node?.children.map((c) => c.topic)).toEqual(["photosynthesis 1", "photosynthesis 2"]);
  });

  it("sends a leaf's article too, with no children to wait for", async () => {
    const h = buildHarness({ breadth: 2 });
    const root = rootOf(1);
    await h.expandNode.execute(root);
    const [child] = await h.queue.receive(1);
    await h.articleQueue.receive(1); // the root's own
    await h.expandNode.execute(child!.message);

    const [leafArticle] = await h.articleQueue.receive(1);
    expect(leafArticle?.message.nodeId).toBe(child!.message.nodeId);
    const node = await h.treeRepo.getNode(child!.message.nodeId);
    expect(node?.children).toHaveLength(0);
  });

  it("sends no article for a node whose expansion failed", async () => {
    const h = buildHarness({ failTimes: { photosynthesis: 1 } });
    await expect(h.expandNode.execute(rootOf(2))).rejects.toThrow();
    // The row exists (C54) but nothing was handed on: an unexpanded node has no brief to write from.
    expect(h.articleQueue.size()).toBe(0);
    expect((await h.treeRepo.getTree(runId))?.status).toBe("pending");
  });
});

import { describe, expect, it } from "vitest";
import { rootConstructMessage } from "../../../../src/application/tree/messages";
import { buildHarness } from "../../../fixtures/build-harness";

const runId = "11111111-1111-4111-8111-111111111111";
const rootOf = (maxDepth: number) => rootConstructMessage(runId, { topic: "photosynthesis", maxDepth, request: "photosynthesis" });

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
    // The children are known but unclaimed - and already carry the brief the root's call wrote for each (C99).
    expect(tree?.children.map((c) => [c.status, c.brief])).toEqual([
      ["pending", "brief for photosynthesis 1"],
      ["pending", "brief for photosynthesis 2"],
    ]);
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

  // C99: the final layer is written by its parent and never called. One call builds a depth-1 tree.
  it("completes a final-layer child itself: no construct message, no call, article queued, parent done", async () => {
    const h = buildHarness({ breadth: 2 });
    await h.runRepo.create({ runId, topic: "photosynthesis", maxDepth: 1, status: "constructing" });
    const root = rootOf(1);
    await h.expandNode.execute(root);

    expect(h.expander.calls).toEqual(["photosynthesis"]);
    expect(h.queue.size()).toBe(0);
    const tree = await h.treeRepo.getTree(runId);
    expect(tree?.status).toBe("done");
    expect(tree?.children.map((c) => [c.topic, c.status, c.brief])).toEqual([
      ["photosynthesis 1", "done", "brief for photosynthesis 1"],
      ["photosynthesis 2", "done", "brief for photosynthesis 2"],
    ]);
    // The root's article and both children's, in one batch.
    const articles = await h.articleQueue.receive(10);
    expect(articles.map((a) => a.message.topic)).toEqual(["photosynthesis", "photosynthesis 1", "photosynthesis 2"]);
    expect(await h.runState.get(runId)).toMatchObject({ nodesDone: 3, nodesFailed: 0 });
    expect((await h.runRepo.get(runId))?.status).toBe("constructed");
  });

  it("a redelivered final-layer parent neither re-counts its children nor re-calls the model", async () => {
    const h = buildHarness({ breadth: 2 });
    await h.runRepo.create({ runId, topic: "photosynthesis", maxDepth: 2, status: "constructing" });
    await h.expandNode.execute(rootOf(2));
    const [child] = await h.queue.receive(1);

    // Simulate a crash after the work was done but before the message was acknowledged.
    await h.expandNode.execute(child!.message);
    const countedOnce = await h.runState.get(runId);
    const queuedOnce = h.queue.size();
    const articlesOnce = h.articleQueue.size();
    await h.expandNode.execute(child!.message);

    expect(h.expander.countFor(child!.message.topic)).toBe(1);
    expect(await h.runState.get(runId)).toEqual(countedOnce);
    // Nothing new on either queue: a final-layer child never gets a construct message at all.
    expect(h.queue.size()).toBe(queuedOnce);
    expect(h.articleQueue.size()).toBe(articlesOnce);
  });

  it("answers a stray final-layer message from the brief it carries, without a call", async () => {
    const h = buildHarness({ breadth: 2 });
    const root = rootOf(1);
    await h.runRepo.create({ runId, topic: "photosynthesis", maxDepth: 1, status: "constructing" });
    await h.expandNode.execute(root);
    const leaf = (await h.articleQueue.receive(10))[1]!.message;

    // Delivered to construction anyway (an old message, an operator re-drive): it must cost nothing.
    await h.expandNode.execute({ ...leaf, pass: "construct" });
    expect(h.expander.calls).toEqual(["photosynthesis"]);
  });

  // C100: the root call names the topic; the raw request never travels further than the root's own message.
  it("records the canonical topic the root named, and never passes the raw request to a child", async () => {
    const h = buildHarness({ breadth: 2, rootTopic: "Photosynthesis" });
    const request = "please teach me photosynthesis, 2 levels deep";
    await h.runRepo.create({ runId, topic: request, maxDepth: 2, status: "constructing" });
    await h.expandNode.execute(rootConstructMessage(runId, { topic: request, maxDepth: 2, request }));

    expect((await h.runRepo.get(runId))?.topic).toBe("Photosynthesis");
    expect((await h.treeRepo.getTree(runId))?.topic).toBe("Photosynthesis");
    const children = (await h.queue.receive(10)).map((r) => r.message);
    for (const message of children) {
      expect(message.request).toBeUndefined();
      expect(message.ancestors[0]?.topic).toBe("Photosynthesis");
      expect(JSON.stringify(message)).not.toContain(request);
    }
    const [rootArticle] = await h.articleQueue.receive(1);
    expect(rootArticle?.message).toMatchObject({ topic: "Photosynthesis" });
    expect(rootArticle?.message.request).toBeUndefined();
  });

  it("keeps the canonical topic when the root is redelivered", async () => {
    const h = buildHarness({ breadth: 2, rootTopic: "Photosynthesis" });
    const request = "teach me photosynthesis";
    await h.runRepo.create({ runId, topic: request, maxDepth: 2, status: "constructing" });
    const root = rootConstructMessage(runId, { topic: request, maxDepth: 2, request });
    await h.expandNode.execute(root);
    await h.expandNode.execute(root);

    expect(h.expander.calls).toHaveLength(1);
    expect((await h.treeRepo.getTree(runId))?.topic).toBe("Photosynthesis");
    expect((await h.runRepo.get(runId))?.topic).toBe("Photosynthesis");
  });

  // C101: the budget is spread evenly. With MAX_NODES_PER_RUN 7 at depth 2 the cap is 2 children per node
  // (1 + 2 + 4 = 7), so every branch reaches the bottom instead of the first branches eating the budget.
  it("cuts each node to the balanced branch cap in teaching order, so every branch reaches full depth", async () => {
    const h = buildHarness({ breadth: 5, maxDepth: 2, maxNodesPerRun: 7 });
    const runBuilt = await h.build("photosynthesis");
    const { tree, stats } = await h.getTree.execute(runBuilt);
    expect(tree?.children.map((c) => c.topic)).toEqual(["photosynthesis 1", "photosynthesis 2"]);
    expect(tree?.children.every((c) => c.children.length === 2)).toBe(true);
    // The 3 children each interior node proposed beyond the cap are reported as skipped (root + 2 = 3 nodes).
    expect(stats).toMatchObject({ nodesDone: 7, nodesSkipped: 9 });
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

  it("sends no article for a node whose expansion failed", async () => {
    const h = buildHarness({ failTimes: { photosynthesis: 1 } });
    await expect(h.expandNode.execute(rootOf(2))).rejects.toThrow();
    // The row exists (C54) but nothing was handed on: an unexpanded node has no brief to write from.
    expect(h.articleQueue.size()).toBe(0);
    expect((await h.treeRepo.getTree(runId))?.status).toBe("pending");
  });
});

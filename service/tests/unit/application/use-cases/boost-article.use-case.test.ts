import { describe, expect, it } from "vitest";
import type { StoredNode } from "../../../../src/application/ports/tree-repository.port";
import { rebuildMessage } from "../../../../src/application/tree/messages";
import { createBoostArticle } from "../../../../src/application/use-cases/boost-article.use-case";
import { NodeNotFoundError } from "../../../../src/domain/errors/node-not-found.error";
import type { AncestorRef, TreeNode } from "../../../../src/domain/schemas/node.schema";
import { buildHarness } from "../../../fixtures/build-harness";

type Harness = ReturnType<typeof buildHarness>;

function boostFor(h: Harness) {
  return createBoostArticle({
    treeRepo: h.treeRepo,
    runRepo: h.runRepo,
    nodeState: h.nodeState,
    queue: h.queue,
    articleQueue: h.articleQueue,
  });
}

function flatten(node: TreeNode): TreeNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

async function lineage(h: Harness, node: StoredNode): Promise<AncestorRef[]> {
  const chain: AncestorRef[] = [];
  let parentId = node.parentId;
  while (parentId !== null) {
    const parent = await h.treeRepo.getNode(parentId);
    if (parent === undefined) break;
    chain.unshift({ depth: parent.depth, topic: parent.topic, brief: parent.brief });
    parentId = parent.parentId;
  }
  return chain;
}

// Construction finished (maxDepth 2, two children per node), every article message still queued.
async function built() {
  const h = buildHarness({ maxDepth: 2, breadth: 2 });
  const runId = await h.build("photosynthesis");
  const tree = await h.treeRepo.getTree(runId);
  if (tree === null) throw new Error("no tree");
  return { h, runId, nodes: flatten(tree) };
}

// Only the root expanded: its children are pending, their construct messages waiting.
async function rootOnly() {
  const h = buildHarness({ maxDepth: 2, breadth: 2 });
  const { runId } = await h.startTreeBuild.execute("photosynthesis");
  const [root] = await h.queue.receive(1);
  await h.expandNode.execute(root!.message);
  await h.queue.delete(root!.receiptId);
  const tree = await h.treeRepo.getTree(runId);
  if (tree === null) throw new Error("no tree");
  return { h, runId, children: tree.children };
}

describe("boost-article use-case (C128)", () => {
  it("throws NodeNotFoundError for an unknown node", async () => {
    const { h } = await built();
    await expect(boostFor(h).execute("99999999-9999-4999-8999-999999999999")).rejects.toBeInstanceOf(NodeNotFoundError);
  });

  it("moves a queued article to the front without adding a message", async () => {
    const { h, nodes } = await built();
    const deepest = nodes.filter((n) => n.depth === 2).at(-1)!;
    const size = h.articleQueue.size();
    await expect(boostFor(h).execute(deepest.id)).resolves.toEqual({ nodeId: deepest.id, status: "promoted" });
    expect(h.articleQueue.size()).toBe(size);
    const [first] = await h.articleQueue.receive(1);
    expect(first?.message).toMatchObject({ nodeId: deepest.id, boost: true });
  });

  it("is idempotent: a second boost leaves exactly one message for the node", async () => {
    const { h, nodes } = await built();
    const target = nodes[3]!;
    const boost = boostFor(h);
    await boost.execute(target.id);
    await boost.execute(target.id);
    const all = await h.articleQueue.receive(100);
    expect(all.filter((r) => r.message.nodeId === target.id)).toHaveLength(1);
  });

  it("an article already in flight answers writing and adds no second copy - never two writer calls", async () => {
    const { h, nodes } = await built();
    const size = h.articleQueue.size();
    const [inFlight] = await h.articleQueue.receive(1);
    await expect(boostFor(h).execute(inFlight!.message.nodeId)).resolves.toMatchObject({ status: "writing" });
    expect(h.articleQueue.size()).toBe(size);
    const rest = await h.articleQueue.receive(100);
    expect(rest.map((r) => r.message.nodeId)).not.toContain(inFlight!.message.nodeId);
    expect(nodes.length).toBe(size);
  });

  it("answers written or failed without touching any queue", async () => {
    const { h, nodes } = await built();
    const [a, b] = [nodes[1]!, nodes[2]!];
    await h.treeRepo.setArticleStatus(a.id, "done");
    await h.treeRepo.setArticleStatus(b.id, "failed", "boom");
    const boost = boostFor(h);
    await expect(boost.execute(a.id)).resolves.toMatchObject({ status: "written" });
    await expect(boost.execute(b.id)).resolves.toMatchObject({ status: "failed" });
    const all = await h.articleQueue.receive(100);
    expect(all.some((r) => r.message.boost === true)).toBe(false);
  });

  it("a node whose construction failed answers failed", async () => {
    const { h, nodes } = await built();
    await h.treeRepo.setStatus(nodes[1]!.id, "failed");
    await expect(boostFor(h).execute(nodes[1]!.id)).resolves.toMatchObject({ status: "failed" });
  });

  it("a node not expanded yet: its construct message goes first and its article is then sent boosted", async () => {
    const { h, children } = await rootOnly();
    const target = children.at(-1)!;
    await expect(boostFor(h).execute(target.id)).resolves.toMatchObject({ status: "awaiting-construction" });
    const [first] = await h.queue.receive(1);
    expect(first?.message).toMatchObject({ nodeId: target.id, boost: true });
    await h.expandNode.execute(first!.message);
    const articles = await h.articleQueue.receive(100);
    expect(articles.find((r) => r.message.nodeId === target.id)?.message.boost).toBe(true);
    // Only the boosted node's own article: its final-layer children were not asked for.
    expect(articles.filter((r) => r.message.boost === true).map((r) => r.message.nodeId)).toEqual([target.id]);
  });

  it("a node being expanded at the moment of the boost still sends its article boosted", async () => {
    const { h, children } = await rootOnly();
    const target = children[0]!;
    const taken = await h.queue.receive(10);
    const inFlight = taken.find((r) => r.message.nodeId === target.id)!;
    await expect(boostFor(h).execute(target.id)).resolves.toMatchObject({ status: "awaiting-construction" });
    // The delivery in hand carries no boost; the recorded one is what expand-node reads.
    expect(inFlight.message.boost).toBeUndefined();
    await h.expandNode.execute(inFlight.message);
    const articles = await h.articleQueue.receive(100);
    expect(articles.find((r) => r.message.nodeId === target.id)?.message.boost).toBe(true);
  });

  it("rebuilds every node's article message exactly as construction sent it", async () => {
    const h = buildHarness({ maxDepth: 3, breadth: 2 });
    const runId = await h.build("photosynthesis");
    const run = await h.runRepo.get(runId);
    const sent = await h.articleQueue.receive(1_000);
    expect(sent.length).toBeGreaterThan(7);
    for (const { message } of sent) {
      const row = await h.treeRepo.getNode(message.nodeId);
      expect(row).toBeDefined();
      expect(rebuildMessage("article", row!, await lineage(h, row!), run!.maxDepth)).toEqual(message);
    }
  });
});

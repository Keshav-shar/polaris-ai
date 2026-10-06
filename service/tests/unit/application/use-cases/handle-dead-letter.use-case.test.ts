import { describe, expect, it } from "vitest";
import { childConstructMessage, rootConstructMessage } from "../../../../src/application/tree/messages";
import { buildHarness } from "../../../fixtures/build-harness";

const runId = "11111111-1111-4111-8111-111111111111";
// maxDepth 1: the root's children are leaves, so each completes as soon as it is expanded.
const root = rootConstructMessage(runId, { topic: "photosynthesis", maxDepth: 1 });

describe("handle-dead-letter use-case", () => {
  it("marks a construct node failed and completes it for its parent", async () => {
    const h = buildHarness({ breadth: 2 });
    await h.runRepo.create({ runId, topic: "photosynthesis", maxDepth: 1, status: "constructing" });
    await h.expandNode.execute(root);
    const [first, second] = await h.queue.receive(2);

    await h.handleDeadLetter.execute(first!.message);
    await h.expandNode.execute(second!.message);

    // The failed sibling still counts, so the root completes rather than waiting forever.
    expect((await h.runRepo.get(runId))?.status).toBe("constructed");
    expect(await h.runState.get(runId)).toMatchObject({ nodesFailed: 1 });
    expect(h.warnings.map((w) => w.msg)).toContain("node dead-lettered");
  });

  it("keeps the dead-lettered node in the tree, marked failed", async () => {
    const h = buildHarness({ breadth: 2 });
    await h.runRepo.create({ runId, topic: "photosynthesis", maxDepth: 1, status: "constructing" });
    await h.expandNode.execute(root);
    const [first] = await h.queue.receive(1);
    await h.handleDeadLetter.execute(first!.message);

    const tree = await h.treeRepo.getTree(runId);
    const failed = tree?.children.find((c) => c.topic === first!.message.topic);
    // The API shows what happened to it rather than silently dropping it (docs/conflicts.md C54).
    expect(failed?.status).toBe("failed");
  });

  it("counts a dead-lettered ARTICLE as failed, so the run can still reach done", async () => {
    // Until Phase 10 this branch only logged and returned. Counting the failure is what stops the run
    // waiting forever for an article that will never be written.
    const h = buildHarness({ breadth: 2 });
    await h.runRepo.create({ runId, topic: "photosynthesis", maxDepth: 1, status: "constructing" });
    await h.expandNode.execute(root);
    for (const receipt of await h.queue.receive(2)) await h.expandNode.execute(receipt.message);

    // The root's article message went out the moment the root was expanded (C91), so it is first.
    const [rootArticle] = await h.articleQueue.receive(1);
    await h.handleDeadLetter.execute(rootArticle!.message);

    expect(await h.runState.get(runId)).toMatchObject({ articlesFailed: 1 });
    expect(h.warnings.map((w) => w.msg)).toContain("article dead-lettered");
  });

  it("cannot strand a subtree, because construction enqueued every article itself (C91)", async () => {
    // C89's bug in its strongest form: the root's article is dead-lettered BEFORE its children are even
    // expanded. Under the old top-down hand-off the children's articles could only ever come from a
    // SUCCESSFUL parent article, so this stranded the whole tree - articlesDone + articlesFailed could
    // never reach nodesDone and the run stayed `constructed` for good (seen live: 17 of 50 nodes
    // unattempted). Now each node sends its own, so a lost scroll costs exactly one scroll.
    const h = buildHarness({ breadth: 2 });
    await h.runRepo.create({ runId, topic: "photosynthesis", maxDepth: 1, status: "constructing" });
    await h.expandNode.execute(root);

    const [rootArticle] = await h.articleQueue.receive(1);
    await h.handleDeadLetter.execute(rootArticle!.message);

    // Only now are the children built - and their article messages arrive regardless.
    for (const receipt of await h.queue.receive(2)) await h.expandNode.execute(receipt.message);
    const children = await h.articleQueue.receive(2);
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.message.pass)).toEqual(["article", "article"]);

    // Once those children are written, articlesDone + articlesFailed reaches nodesDone and the run
    // leaves `constructed`.
    for (const child of children) await h.fanIn.completeArticle(runId, child.message.nodeId, "done");
    expect((await h.runRepo.get(runId))?.status).toBe("done");
  });

  it("records WHY the article failed, on the node and in the log", async () => {
    // Until now the dead-letter path recorded THAT a scroll was lost and nothing about why: the cause
    // existed only in the worker's stdout, so a 429 and an unparseable draft - which need opposite
    // fixes - were indistinguishable from the API.
    const h = buildHarness({ breadth: 2 });
    await h.runRepo.create({ runId, topic: "photosynthesis", maxDepth: 1, status: "constructing" });
    await h.expandNode.execute(root);
    for (const receipt of await h.queue.receive(2)) await h.expandNode.execute(receipt.message);
    const [rootArticle] = await h.articleQueue.receive(1);

    const cause = new Error("model returned no valid JSON");
    cause.name = "StructuredOutputError";
    await h.handleDeadLetter.execute(rootArticle!.message, cause);

    const node = await h.treeRepo.getNode(rootArticle!.message.nodeId);
    expect(node?.articleStatus).toBe("failed");
    // The NAME is the diagnostic half: it is what separates a bad draft from a rate limit.
    expect(node?.articleFailureReason).toBe("StructuredOutputError: model returned no valid JSON");
    expect(h.warnings.find((w) => w.msg === "article dead-lettered")?.context).toMatchObject({
      reason: "StructuredOutputError: model returned no valid JSON",
    });
  });

  it("enqueues nothing at all, however often the dead-letter is redelivered", async () => {
    const h = buildHarness({ breadth: 2 });
    await h.runRepo.create({ runId, topic: "photosynthesis", maxDepth: 1, status: "constructing" });
    await h.expandNode.execute(root);
    for (const receipt of await h.queue.receive(2)) await h.expandNode.execute(receipt.message);
    const [rootArticle] = await h.articleQueue.receive(1);

    await h.handleDeadLetter.execute(rootArticle!.message);
    await h.handleDeadLetter.execute(rootArticle!.message);

    // The two left are the children's own messages, sent by their expansions; the failure path added none.
    expect(await h.articleQueue.receive(10)).toHaveLength(2);
  });

  it("does not let a duplicate article dead-letter count twice", async () => {
    const h = buildHarness({ breadth: 2 });
    await h.runRepo.create({ runId, topic: "photosynthesis", maxDepth: 1, status: "constructing" });
    await h.expandNode.execute(root);
    for (const receipt of await h.queue.receive(2)) await h.expandNode.execute(receipt.message);
    const [rootArticle] = await h.articleQueue.receive(1);

    await h.handleDeadLetter.execute(rootArticle!.message);
    await h.handleDeadLetter.execute(rootArticle!.message);

    // finishArticle's conditional transition is what makes the second one a no-op.
    expect(await h.runState.get(runId)).toMatchObject({ articlesFailed: 1 });
  });
});

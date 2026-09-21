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

  it("ignores an article message until the article pass exists", async () => {
    const h = buildHarness();
    const article = { ...childConstructMessage(root, "b", "light reactions"), pass: "article" as const };
    await expect(h.handleDeadLetter.execute(article)).resolves.toBeUndefined();
    expect(h.warnings.map((w) => w.msg)).toContain("article dead-letter ignored (Phase 10)");
  });
});

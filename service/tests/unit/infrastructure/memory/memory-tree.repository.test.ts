import { describe, expect, it } from "vitest";
import { childConstructMessage, rootConstructMessage } from "../../../../src/application/tree/messages";
import { createMemoryTreeRepository } from "../../../../src/infrastructure/memory/memory-tree.repository";

const runId = "11111111-1111-4111-8111-111111111111";
const root = rootConstructMessage(runId, { topic: "photosynthesis", maxDepth: 2, request: "photosynthesis" });
const light = childConstructMessage(root, "root brief", { topic: "light reactions", brief: "child brief" });
const calvin = childConstructMessage(root, "root brief", { topic: "calvin cycle", brief: "child brief" });

describe("memory tree repository", () => {
  it("returns null until the root has been written", async () => {
    const repo = createMemoryTreeRepository();
    expect(await repo.getTree(runId)).toBeNull();
    await repo.upsertNode(light, "a child before its parent");
    // A child alone is not a tree: the UI shows nothing rather than a headless fragment.
    expect(await repo.getTree(runId)).toBeNull();
  });

  it("nests children under their parent", async () => {
    const repo = createMemoryTreeRepository();
    await repo.upsertNode(root, "root brief");
    await repo.upsertNode(light, "light brief");
    await repo.upsertNode(calvin, "calvin brief");
    const tree = await repo.getTree(runId);
    expect(tree?.topic).toBe("photosynthesis");
    expect(tree?.children.map((c) => c.topic)).toEqual(["light reactions", "calvin cycle"]);
    expect(tree?.children[0]?.depth).toBe(1);
  });

  it("rule 6: upserting the same node twice leaves one row", async () => {
    const repo = createMemoryTreeRepository();
    await repo.upsertNode(root, "first");
    await repo.upsertNode(root, "second");
    const tree = await repo.getTree(runId);
    expect(tree?.brief).toBe("second");
    expect(tree?.children).toEqual([]);
  });

  it("never drags a finished node back to expanded", async () => {
    const repo = createMemoryTreeRepository();
    await repo.upsertNode(root, "b");
    await repo.setStatus(root.nodeId, "done");
    await repo.upsertNode(root, "b");
    expect((await repo.getTree(runId))?.status).toBe("done");
  });

  it("keeps a failed node and its subtree, so the partial tree stays whole", async () => {
    const repo = createMemoryTreeRepository();
    const grandchild = childConstructMessage(light, "light brief", { topic: "photosystem ii", brief: "child brief" });
    await repo.upsertNode(root, "root brief");
    await repo.upsertNode(light, "light brief");
    await repo.upsertNode(grandchild, "grandchild brief");
    await repo.upsertNode(calvin, "calvin brief");
    await repo.setStatus(light.nodeId, "failed");
    const tree = await repo.getTree(runId);
    // Pruning the failed row used to strand its subtree too, leaving an unexplained hole where work the
    // user had already paid an LLM call for should be (docs/conflicts.md C54).
    expect(tree?.children.map((c) => c.topic)).toEqual(["light reactions", "calvin cycle"]);
    expect(tree?.children[0]).toMatchObject({ status: "failed", brief: "light brief" });
    expect(tree?.children[0]?.children.map((c) => c.topic)).toEqual(["photosystem ii"]);
  });

  it("records a node with no brief yet as pending, and never blanks a brief it already has", async () => {
    const repo = createMemoryTreeRepository();
    await repo.upsertNode(root, null);
    expect(await repo.getTree(runId)).toMatchObject({ status: "pending", brief: "" });

    await repo.upsertNode(root, "root brief");
    expect(await repo.getTree(runId)).toMatchObject({ status: "expanded", brief: "root brief" });

    // A redelivery re-claims the node before expanding it; that must not undo what is already stored.
    await repo.upsertNode(root, null);
    expect(await repo.getTree(runId)).toMatchObject({ status: "expanded", brief: "root brief" });
  });

  it("upsertPending makes the whole known frontier visible in one write", async () => {
    const repo = createMemoryTreeRepository();
    await repo.upsertNode(root, "root brief");
    await repo.upsertPending([light, calvin]);
    const tree = await repo.getTree(runId);
    expect(tree?.children.map((c) => c.topic)).toEqual(["light reactions", "calvin cycle"]);
    // Each child row takes the brief its parent wrote for it (C99), from the start.
    expect(tree?.children.every((c) => c.status === "pending" && c.brief === "child brief")).toBe(true);
  });

  it("keeps runs apart", async () => {
    const repo = createMemoryTreeRepository();
    const otherRun = "22222222-2222-4222-8222-222222222222";
    await repo.upsertNode(root, "b");
    await repo.upsertNode(rootConstructMessage(otherRun, { topic: "mitosis", maxDepth: 1, request: "mitosis" }), "b2");
    expect((await repo.getTree(otherRun))?.topic).toBe("mitosis");
    expect((await repo.getTree(runId))?.topic).toBe("photosynthesis");
  });
});

describe("memory tree repository, article axis vs construction upserts (C132)", () => {
  it("a redelivered parent re-sending its children's rows does not erase a written or failed scroll", async () => {
    const repo = createMemoryTreeRepository();
    await repo.upsertNode(root, "root brief");
    await repo.upsertPending([light, calvin]);
    await repo.setArticleStatus(light.nodeId, "done");
    await repo.setArticleStatus(calvin.nodeId, "failed", "RateLimitError: 429");
    // The parent's expansion is redelivered after its final-layer children were already written.
    await repo.upsertPending([light, calvin]);
    await repo.upsertNode(light, null);
    expect((await repo.getNode(light.nodeId))?.articleStatus).toBe("done");
    expect(await repo.getNode(calvin.nodeId)).toMatchObject({
      articleStatus: "failed",
      articleFailureReason: "RateLimitError: 429",
    });
  });

  it("exposes the path each node's messages carry, so a message can be rebuilt from rows (C128)", async () => {
    const repo = createMemoryTreeRepository();
    await repo.upsertNode(root, "root brief");
    await repo.upsertPending([light]);
    expect((await repo.getNode(light.nodeId))?.path).toBe(light.path);
  });
});

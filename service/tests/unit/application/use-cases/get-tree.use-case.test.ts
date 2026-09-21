import { describe, expect, it } from "vitest";
import { createGetTree } from "../../../../src/application/use-cases/get-tree.use-case";
import { rootConstructMessage } from "../../../../src/application/tree/messages";
import { RunNotFoundError } from "../../../../src/domain/errors/run-not-found.error";
import { createMemoryRunRepository } from "../../../../src/infrastructure/memory/memory-run.repository";
import { createMemoryRunStateStore } from "../../../../src/infrastructure/memory/memory-run-state.store";
import { createMemoryTreeRepository } from "../../../../src/infrastructure/memory/memory-tree.repository";
import { buildHarness } from "../../../fixtures/build-harness";

const runId = "11111111-1111-4111-8111-111111111111";

describe("get-tree use-case", () => {
  it("throws RunNotFoundError for an unknown run", async () => {
    const getTree = createGetTree({
      runRepo: createMemoryRunRepository(),
      treeRepo: createMemoryTreeRepository(),
      runState: createMemoryRunStateStore(),
    });
    await expect(getTree.execute(runId)).rejects.toThrow(RunNotFoundError);
  });

  it("reports a run that has not expanded its root yet, rather than failing", async () => {
    const runRepo = createMemoryRunRepository();
    await runRepo.create({ runId, topic: "photosynthesis", maxDepth: 2, status: "constructing" });
    const getTree = createGetTree({
      runRepo,
      treeRepo: createMemoryTreeRepository(),
      runState: createMemoryRunStateStore(),
    });
    const result = await getTree.execute(runId);
    // The UI polls from the moment it gets a runId, so "no tree yet" must be a normal answer.
    expect(result.tree).toBeNull();
    expect(result.stats).toEqual({
      nodesDone: 0,
      nodesFailed: 0,
      nodesSkipped: 0,
      articlesDone: 0,
      articlesFailed: 0,
    });
    expect(result.run).toMatchObject({ topic: "photosynthesis", status: "constructing" });
  });

  it("returns the finished tree with its counters", async () => {
    const h = buildHarness({ maxDepth: 1, breadth: 2 });
    const built = await h.build("photosynthesis");
    const result = await h.getTree.execute(built);

    expect(result.run.status).toBe("constructed");
    expect(result.tree?.topic).toBe("photosynthesis");
    expect(result.tree?.children.map((c) => c.topic)).toEqual(["photosynthesis 1", "photosynthesis 2"]);
    // Every node reached a terminal state: root + 2 leaves.
    expect(result.stats).toMatchObject({ nodesDone: 3, nodesFailed: 0 });
    expect(result.tree?.children.every((c) => c.status === "done")).toBe(true);
  });

  it("keeps failed nodes in the tree, marked failed, and still counts them", async () => {
    // They used to be pruned along with their whole subtree. A node the user paid an LLM call for is
    // worth showing even when it ended badly - hiding it leaves a hole with no explanation (C54).
    const h = buildHarness({ maxDepth: 1, breadth: 2 });
    await h.runRepo.create({ runId, topic: "photosynthesis", maxDepth: 1, status: "constructing" });
    const root = rootConstructMessage(runId, { topic: "photosynthesis", maxDepth: 1 });
    await h.expandNode.execute(root);
    const [first, second] = await h.queue.receive(2);
    await h.handleDeadLetter.execute(first!.message);
    await h.expandNode.execute(second!.message);

    const result = await h.getTree.execute(runId);
    expect(result.tree?.children).toHaveLength(2);
    expect(result.tree?.children.map((c) => c.status).sort()).toEqual(["done", "failed"]);
    expect(result.stats).toMatchObject({ nodesDone: 2, nodesFailed: 1 });
  });

  it("reports the unfinished nodes of a halted run as blocked, with the reason", async () => {
    const h = buildHarness({ maxDepth: 1, breadth: 2 });
    await h.runRepo.create({ runId, topic: "photosynthesis", maxDepth: 1, status: "constructing" });
    const root = rootConstructMessage(runId, { topic: "photosynthesis", maxDepth: 1 });
    // The root expands, its children are queued - and then the quota runs out.
    await h.expandNode.execute(root);
    await h.runRepo.setStatus(runId, "halted", "LLM daily quota exhausted");

    const result = await h.getTree.execute(runId);
    expect(result.run).toMatchObject({ status: "halted", haltReason: "LLM daily quota exhausted" });
    // The root was expanded but never completed, and its children were never claimed at all.
    expect(result.tree?.status).toBe("blocked");
    expect(result.tree?.children.map((c) => c.topic)).toEqual(["photosynthesis 1", "photosynthesis 2"]);
    expect(result.tree?.children.every((c) => c.status === "blocked")).toBe(true);
    expect(result.tree?.children.every((c) => c.brief === "")).toBe(true);
  });

  it("shows a node under its topic even when its very first expansion failed", async () => {
    const h = buildHarness({ maxDepth: 1, breadth: 2, failTimes: { photosynthesis: 1 } });
    await h.runRepo.create({ runId, topic: "photosynthesis", maxDepth: 1, status: "constructing" });
    const root = rootConstructMessage(runId, { topic: "photosynthesis", maxDepth: 1 });
    await expect(h.expandNode.execute(root)).rejects.toThrow();

    // The row is written before the LLM call, so a failed expansion still leaves something to render.
    const result = await h.getTree.execute(runId);
    expect(result.tree).toMatchObject({ topic: "photosynthesis", status: "pending", brief: "" });
  });
});

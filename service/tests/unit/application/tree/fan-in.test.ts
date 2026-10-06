import { beforeEach, describe, expect, it } from "vitest";
import { createFanIn, type FanIn } from "../../../../src/application/tree/fan-in";
import { childConstructMessage, rootConstructMessage } from "../../../../src/application/tree/messages";
import { createMemoryNodeStateStore } from "../../../../src/infrastructure/memory/memory-node-state.store";
import { createMemoryRunRepository } from "../../../../src/infrastructure/memory/memory-run.repository";
import { createMemoryRunStateStore } from "../../../../src/infrastructure/memory/memory-run-state.store";
import { createMemoryTreeRepository } from "../../../../src/infrastructure/memory/memory-tree.repository";

const runId = "11111111-1111-4111-8111-111111111111";
const root = rootConstructMessage(runId, { topic: "photosynthesis", maxDepth: 2 });
const light = childConstructMessage(root, "root brief", "light reactions");
const calvin = childConstructMessage(root, "root brief", "calvin cycle");

// Built on the real memory stores: fan-in is only correct if the conditional writes underneath it are.
function setup() {
  const nodeState = createMemoryNodeStateStore();
  const treeRepo = createMemoryTreeRepository();
  const runState = createMemoryRunStateStore();
  const runRepo = createMemoryRunRepository();
  const fanIn = createFanIn({ nodeState, treeRepo, runState, runRepo });
  return { nodeState, treeRepo, runState, runRepo, fanIn };
}

// Expands the root with two children, leaving both children pending.
async function expandRoot(nodeState: ReturnType<typeof createMemoryNodeStateStore>) {
  await nodeState.claim({ runId, nodeId: root.nodeId, parentId: null, depth: 0 });
  await nodeState.saveResult(root.nodeId, { brief: "root brief", children: ["light reactions", "calvin cycle"] });
  await nodeState.createPending([light, calvin]);
}

describe("fan-in", () => {
  let ctx: ReturnType<typeof setup>;
  let fanIn: FanIn;
  beforeEach(async () => {
    ctx = setup();
    fanIn = ctx.fanIn;
    await ctx.runRepo.create({ runId, topic: "photosynthesis", maxDepth: 2, status: "constructing" });
    await ctx.treeRepo.upsertNode(root, "root brief");
    await expandRoot(ctx.nodeState);
  });

  it("completes the parent only once every child is accounted for", async () => {
    await fanIn.completeConstruction(light.nodeId, "done");
    expect((await ctx.runRepo.get(runId))?.status).toBe("constructing");
    await fanIn.completeConstruction(calvin.nodeId, "done");
    expect((await ctx.runRepo.get(runId))?.status).toBe("constructed");
  });

  it("completes the parent exactly once when the last children finish out of order", async () => {
    // Reverse order, and each child completed twice: the parent must still be counted once.
    await fanIn.completeConstruction(calvin.nodeId, "done");
    await fanIn.completeConstruction(calvin.nodeId, "done");
    await fanIn.completeConstruction(light.nodeId, "done");
    await fanIn.completeConstruction(light.nodeId, "done");
    const state = await ctx.runState.get(runId);
    // root + 2 children, counted once each.
    expect(state?.nodesDone).toBe(3);
  });

  it("a failed child still completes its parent, so a failed branch never blocks its ancestors", async () => {
    await fanIn.completeConstruction(light.nodeId, "failed");
    await fanIn.completeConstruction(calvin.nodeId, "done");
    expect((await ctx.runRepo.get(runId))?.status).toBe("constructed");
    const state = await ctx.runState.get(runId);
    expect(state).toMatchObject({ nodesDone: 2, nodesFailed: 1 });
  });

  it("marks the tree rows, including the failed one, which is kept", async () => {
    // setStatus only touches rows that exist, so give the children rows the way expand-node now does.
    await ctx.treeRepo.upsertPending([light, calvin]);
    await fanIn.completeConstruction(light.nodeId, "failed");
    await fanIn.completeConstruction(calvin.nodeId, "done");
    const tree = await ctx.treeRepo.getTree(runId);
    expect(tree?.status).toBe("done");
    expect(tree?.children.map((c) => [c.topic, c.status])).toEqual([
      ["light reactions", "failed"],
      ["calvin cycle", "done"],
    ]);
  });

  it("cascades several levels in one call", async () => {
    const deep = setup();
    await deep.runRepo.create({ runId, topic: "photosynthesis", maxDepth: 2, status: "constructing" });
    const grandchild = childConstructMessage(light, "light brief", "photosystem ii");
    await deep.nodeState.claim({ runId, nodeId: root.nodeId, parentId: null, depth: 0 });
    await deep.nodeState.saveResult(root.nodeId, { brief: "b", children: ["light reactions"] });
    await deep.nodeState.createPending([light]);
    await deep.nodeState.claim({ runId, nodeId: light.nodeId, parentId: root.nodeId, depth: 1 });
    await deep.nodeState.saveResult(light.nodeId, { brief: "b", children: ["photosystem ii"] });
    await deep.nodeState.createPending([grandchild]);

    // One completion at the bottom finishes the leaf, its parent and the root.
    await deep.fanIn.completeConstruction(grandchild.nodeId, "done");
    expect((await deep.runRepo.get(runId))?.status).toBe("constructed");
    expect((await deep.runState.get(runId))?.nodesDone).toBe(3);
  });

  it("stops at a parent the dead-letter path already failed, instead of resurrecting it", async () => {
    await ctx.fanIn.completeConstruction(root.nodeId, "failed");
    await ctx.fanIn.completeConstruction(light.nodeId, "done");
    await ctx.fanIn.completeConstruction(calvin.nodeId, "done");
    const run = await ctx.runRepo.get(runId);
    // A failed root fails the run, and its children completing afterwards must not flip it to constructed.
    expect(run?.status).toBe("failed");
  });

  it("does not declare the run done while construction is still running", async () => {
    // The trap C91 opens: articles land while nodesDone is still climbing, so counting alone would call
    // a run finished after its first leaf's scroll.
    await fanIn.completeConstruction(light.nodeId, "done");
    expect(await fanIn.completeArticle(runId, light.nodeId, "done")).toBe(true);
    expect((await ctx.runRepo.get(runId))?.status).toBe("constructing");

    await fanIn.completeConstruction(calvin.nodeId, "done");
    expect((await ctx.runRepo.get(runId))?.status).toBe("constructed");
    await fanIn.completeArticle(runId, calvin.nodeId, "done");
    await fanIn.completeArticle(runId, root.nodeId, "done");
    expect((await ctx.runRepo.get(runId))?.status).toBe("done");
  });

  it("finishes a run whose articles were all already in when construction ended", async () => {
    // The other half: if every scroll is written before the root completes, the only moment left to
    // notice is the root's own completion.
    await fanIn.completeArticle(runId, root.nodeId, "done");
    await fanIn.completeArticle(runId, light.nodeId, "done");
    await fanIn.completeArticle(runId, calvin.nodeId, "done");
    await fanIn.completeConstruction(light.nodeId, "done");
    await fanIn.completeConstruction(calvin.nodeId, "done");
    expect((await ctx.runRepo.get(runId))?.status).toBe("done");
  });

  it("is a no-op for a node that is already terminal", async () => {
    await fanIn.completeConstruction(light.nodeId, "done");
    await fanIn.completeConstruction(light.nodeId, "done");
    expect((await ctx.runState.get(runId))?.nodesDone).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { ANCESTOR_WINDOW, QUEUE } from "../../../../src/config/constants";
import { branchCap, fullTreeSize } from "../../../../src/domain/traversal/branch-cap";
import { QuotaExhaustedError } from "../../../../src/domain/errors/quota-exhausted.error";
import type { TreeNode } from "../../../../src/domain/schemas/node.schema";
import { buildHarness } from "../../../fixtures/build-harness";

// End-to-end through the real coordination stack (memory adapters + worker) with a fake expander in place
// of the LLM. These are the build-plan invariants for the whole construction pass.
function flatten(node: TreeNode): TreeNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

describe("construction loop", () => {
  it("builds a tree that stops at exactly maxDepth, with childless leaves", async () => {
    const maxDepth = 3;
    const h = buildHarness({ maxDepth, breadth: 2 });
    const runId = await h.build("photosynthesis");
    const { tree, run } = await h.getTree.execute(runId);

    const nodes = flatten(tree!);
    expect(run.status).toBe("constructed");
    // The leaf layer returns no children, which is the hard stop on the tree's height.
    expect(Math.max(...nodes.map((n) => n.depth))).toBe(maxDepth);
    expect(nodes.every((n) => n.depth <= maxDepth)).toBe(true);
    for (const node of nodes) {
      if (node.depth === maxDepth) expect(node.children).toEqual([]);
      else expect(node.children.length).toBeGreaterThan(0);
    }
  });

  it("never puts more than ANCESTOR_WINDOW ancestors on a message, at any depth", async () => {
    const h = buildHarness({ maxDepth: 4, breadth: 2 });
    // Observe every message as the worker receives it.
    const seen: number[] = [];
    const original = h.queue.receive.bind(h.queue);
    h.queue.receive = async (max: number) => {
      const receipts = await original(max);
      for (const r of receipts) seen.push(r.message.ancestors.length);
      return receipts;
    };
    await h.build("photosynthesis");
    expect(seen.length).toBeGreaterThan(5);
    expect(Math.max(...seen)).toBeLessThanOrEqual(ANCESTOR_WINDOW);
  });

  it("marks a node failed after QUEUE.MAX_RECEIVES failures, and its parent still completes", async () => {
    const h = buildHarness({
      // Depth 2, so the root's children are interior nodes that are actually called (C99).
      maxDepth: 2,
      breadth: 2,
      // One child fails every delivery; the other is fine.
      failTimes: { "photosynthesis 1": QUEUE.MAX_RECEIVES },
    });
    const runId = await h.build("photosynthesis");
    const { tree, run, stats } = await h.getTree.execute(runId);

    expect(run.status).toBe("constructed");
    // done: the root, the healthy child and its 2 final-layer children.
    expect(stats).toMatchObject({ nodesDone: 4, nodesFailed: 1 });
    // The failed branch stays in the tree, marked failed, and never hangs its parent.
    expect(tree?.children.map((c) => c.topic)).toEqual(["photosynthesis 1", "photosynthesis 2"]);
    expect(tree?.children.map((c) => c.status)).toEqual(["failed", "done"]);
    expect(h.expander.countFor("photosynthesis 1")).toBe(QUEUE.MAX_RECEIVES);
  });

  it("stays inside MAX_NODES_PER_RUN by spreading it evenly, and still finishes the run cleanly", async () => {
    // Q6's answer: depth alone cannot bound cost. maxDepth 2 at breadth 5 wants 31 nodes; the budget allows
    // 20, so the balanced cap is 3 children per node (1 + 3 + 9 = 13) - every branch reaches the bottom
    // instead of the first branches spending the budget and the last ones stopping a layer short (C101).
    const h = buildHarness({ maxDepth: 2, breadth: 5, concurrency: 1, maxNodesPerRun: 20 });
    const runId = await h.build("photosynthesis");
    const { tree, run, stats } = await h.getTree.execute(runId);

    const cap = branchCap(20, 2);
    expect(cap).toBe(3);
    const nodes = flatten(tree!);
    expect(nodes.length).toBe(fullTreeSize(cap, 2));
    expect(nodes.filter((n) => n.depth < 2).every((n) => n.children.length === cap)).toBe(true);
    // The children the cap refused are reported, so the UI can say the tree is narrower than it could be.
    expect(stats.nodesSkipped).toBe((5 - cap) * (1 + cap));
    // The critical part: trimming happens BEFORE the child set is stored, so every parent's fan-in
    // still completes. Trim after saveResult and the run would hang at `constructing` forever.
    expect(run.status).toBe("constructed");
    expect(stats).toMatchObject({ nodesFailed: 0 });
    expect(h.warnings.map((w) => w.msg)).toContain("children trimmed to the branch cap");
  });

  it("never spends more LLM calls than the node budget allows", async () => {
    const h = buildHarness({ maxDepth: 5, breadth: 5, concurrency: 2, maxNodesPerRun: 12 });
    await h.build("photosynthesis");
    // Without the cap this tree is thousands of nodes.
    expect(h.expander.calls.length).toBeLessThanOrEqual(12);
  });

  it("hands back the partial tree when the daily quota runs out mid-build", async () => {
    // The reported failure: depth 3 on a 20/day free tier. Everything paid for before the halt must
    // survive, and the nodes that never got their turn must say why (docs/conflicts.md C54, C55).
    const h = buildHarness({ maxDepth: 2, breadth: 2, concurrency: 1, quotaAfter: 1 });
    const runId = await h.build("photosynthesis");
    const { tree, run, stats } = await h.getTree.execute(runId);

    expect(run.status).toBe("halted");
    expect(run.haltReason).toMatch(/daily quota/i);
    expect(h.fatals[0]).toBeInstanceOf(QuotaExhaustedError);

    // The root was expanded and paid for, so its brief is there; the frontier it discovered is listed.
    expect(tree?.topic).toBe("photosynthesis");
    expect(tree?.brief).toBe("brief for photosynthesis");
    expect(tree?.children.map((c) => c.topic)).toEqual(["photosynthesis 1", "photosynthesis 2"]);
    expect(tree?.children.every((c) => c.status === "blocked")).toBe(true);
    // A halt is not a failure: nothing was dead-lettered and no node is marked failed.
    expect(stats).toMatchObject({ nodesFailed: 0 });
  });

  it("stops at the first 429 instead of burning retries on every node", async () => {
    // Before the classifier fix each node spent 1 + LLM.MAX_RETRIES requests rediscovering the same
    // dead quota. The expander must be called exactly once more than the quota allowed.
    const h = buildHarness({ maxDepth: 2, breadth: 3, concurrency: 1, quotaAfter: 1 });
    await h.build("photosynthesis");
    expect(h.expander.calls).toHaveLength(2);
  });

  it("expands the frontier in parallel, capped by W_expand rather than by tree width", async () => {
    const delayMs = 50;
    const breadth = 5;
    const maxDepth = 3;
    const concurrency = 4;
    // This one is about W_expand, not cost: lift the node budget so the full 156-node tree is built and
    // the assertion below still measures parallelism rather than MAX_NODES_PER_RUN.
    const h = buildHarness({ maxDepth, breadth, delayMs, concurrency, maxNodesPerRun: 1_000 });

    const started = Date.now();
    const runId = await h.build("photosynthesis");
    const elapsed = Date.now() - started;

    const nodes = flatten((await h.getTree.execute(runId)).tree!);
    // 1 + 5 + 25 + 125 nodes; sequentially that is nodes * delayMs.
    expect(nodes.length).toBe(1 + breadth + breadth ** 2 + breadth ** 3);
    expect(elapsed).toBeLessThan((nodes.length * delayMs) / 2);
    // The cap is what keeps in-flight LLM calls bounded however wide a layer gets.
    expect(h.expander.maxObservedConcurrency).toBeLessThanOrEqual(concurrency);
    expect(h.expander.maxObservedConcurrency).toBeGreaterThan(1);
  });

  // THE regression for C99: one call per node that has children, and none at all for the final layer -
  // whose topic and brief its parent's call already wrote.
  it("calls the expander once per interior node and never for the final layer", async () => {
    const h = buildHarness({ maxDepth: 3, breadth: 3 });
    const runId = await h.build("photosynthesis");
    const nodes = flatten((await h.getTree.execute(runId)).tree!);
    const interior = nodes.filter((n) => n.depth < 3);
    const finalLayer = nodes.filter((n) => n.depth === 3);

    expect(nodes).toHaveLength(1 + 3 + 9 + 27);
    expect(h.expander.calls).toHaveLength(interior.length);
    expect(new Set(h.expander.calls).size).toBe(h.expander.calls.length);
    for (const leaf of finalLayer) {
      expect(h.expander.countFor(leaf.topic)).toBe(0);
      expect(leaf.status).toBe("done");
      expect(leaf.brief).toBe(`brief for ${leaf.topic}`);
    }
    // Every node, leaves included, still gets exactly one article message.
    const articles = await h.articleQueue.receive(1_000);
    expect(articles.map((a) => a.message.nodeId).sort()).toEqual(nodes.map((n) => n.id).sort());
  });
});

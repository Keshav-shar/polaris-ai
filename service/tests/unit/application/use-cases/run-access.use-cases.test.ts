import { describe, expect, it } from "vitest";
import { createBoostArticle } from "../../../../src/application/use-cases/boost-article.use-case";
import { createGetNode } from "../../../../src/application/use-cases/get-node.use-case";
import { createGetTree } from "../../../../src/application/use-cases/get-tree.use-case";
import { createListRuns } from "../../../../src/application/use-cases/list-runs.use-case";
import { createSetRunVisibility } from "../../../../src/application/use-cases/set-run-visibility.use-case";
import { rootConstructMessage } from "../../../../src/application/tree/messages";
import { NodeNotFoundError } from "../../../../src/domain/errors/node-not-found.error";
import { RunNotFoundError } from "../../../../src/domain/errors/run-not-found.error";
import { UnauthenticatedError } from "../../../../src/domain/errors/unauthenticated.error";
import { createMemoryArticleRepository } from "../../../../src/infrastructure/memory/memory-article.repository";
import { createMemoryNodeQueue } from "../../../../src/infrastructure/memory/memory-node-queue.adapter";
import { createMemoryNodeStateStore } from "../../../../src/infrastructure/memory/memory-node-state.store";
import { createMemoryQuizStore } from "../../../../src/infrastructure/memory/memory-quiz.store";
import { createMemoryRunRepository } from "../../../../src/infrastructure/memory/memory-run.repository";
import { createMemoryRunStateStore } from "../../../../src/infrastructure/memory/memory-run-state.store";
import { createMemoryTreeRepository } from "../../../../src/infrastructure/memory/memory-tree.repository";

const owner = { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const other = { userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
const runId = "11111111-1111-4111-8111-111111111111";

async function setup(visibility: "private" | "unlisted" | "public" = "private") {
  const runRepo = createMemoryRunRepository();
  const treeRepo = createMemoryTreeRepository();
  const runState = createMemoryRunStateStore(500);
  await runRepo.create({ runId, topic: "Photosynthesis", maxDepth: 1, status: "done", ownerId: owner.userId, visibility });
  const root = rootConstructMessage(runId, { topic: "Photosynthesis", maxDepth: 1, request: "secret prompt" });
  await treeRepo.upsertNode(root, "Plants make sugar.");
  const deps = {
    runRepo,
    treeRepo,
    runState,
    getTree: createGetTree({ runRepo, treeRepo, runState }),
    getNode: createGetNode({
      treeRepo,
      runRepo,
      articleRepo: createMemoryArticleRepository(),
      quizStore: createMemoryQuizStore(),
    }),
    boost: createBoostArticle({
      treeRepo,
      runRepo,
      nodeState: createMemoryNodeStateStore(),
      queue: createMemoryNodeQueue(),
      articleQueue: createMemoryNodeQueue(),
    }),
    setVisibility: createSetRunVisibility({ runRepo }),
    listRuns: createListRuns({ runs: runRepo, authRequired: true }),
  };
  return { ...deps, nodeId: root.nodeId };
}

describe("read access through the use-cases (C105)", () => {
  it("answers 404 for a private run to anyone but its owner - never 403", async () => {
    const { getTree, getNode, boost, nodeId } = await setup("private");
    await expect(getTree.execute(runId, other)).rejects.toBeInstanceOf(RunNotFoundError);
    await expect(getTree.execute(runId)).rejects.toBeInstanceOf(RunNotFoundError);
    await expect(getNode.execute(nodeId, other)).rejects.toBeInstanceOf(NodeNotFoundError);
    await expect(boost.execute(nodeId, other)).rejects.toBeInstanceOf(NodeNotFoundError);
  });

  it("serves the owner, and tells them they own it", async () => {
    const { getTree, getNode, nodeId } = await setup("private");
    const tree = await getTree.execute(runId, owner);
    expect(tree.run).toMatchObject({ visibility: "private", isOwner: true });
    await expect(getNode.execute(nodeId, owner)).resolves.toMatchObject({ node: { id: nodeId } });
  });

  it("serves an unlisted run to anyone, as not theirs, and never leaks the raw request", async () => {
    const { getTree } = await setup("unlisted");
    const tree = await getTree.execute(runId, other);
    expect(tree.run.isOwner).toBe(false);
    expect(JSON.stringify(tree)).not.toContain("secret prompt");
  });

  it("falls back to the stats copied at the terminal transition once live counters are gone (C107)", async () => {
    const { getTree, runRepo } = await setup("private");
    const stats = { nodesDone: 3, nodesFailed: 1, nodesSkipped: 2, articlesDone: 3, articlesFailed: 0 };
    await runRepo.setStats(runId, stats);
    expect((await getTree.execute(runId, owner)).stats).toEqual(stats);
  });
});

describe("set-run-visibility", () => {
  it("lets the owner share a map", async () => {
    const { setVisibility, getTree } = await setup("private");
    await expect(setVisibility.execute(runId, "public", owner)).resolves.toEqual({ runId, visibility: "public" });
    await expect(getTree.execute(runId)).resolves.toBeDefined();
  });

  it("gives anyone else the same 404 as an unknown run, even on a public map", async () => {
    const { setVisibility } = await setup("public");
    await expect(setVisibility.execute(runId, "private", other)).rejects.toBeInstanceOf(RunNotFoundError);
    await expect(setVisibility.execute(runId, "private", undefined)).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe("list-runs scopes", () => {
  it("needs sign-in for `mine` and lists only the caller's runs", async () => {
    const { listRuns } = await setup("private");
    await expect(listRuns.execute(10)).rejects.toBeInstanceOf(UnauthenticatedError);
    expect((await listRuns.execute(10, { caller: owner })).runs).toHaveLength(1);
    expect((await listRuns.execute(10, { caller: other })).runs).toHaveLength(0);
  });

  it("lists public maps for anyone, and only those", async () => {
    const { listRuns, setVisibility } = await setup("private");
    expect((await listRuns.execute(10, { scope: "public" })).runs).toHaveLength(0);
    await setVisibility.execute(runId, "public", owner);
    const { runs } = await listRuns.execute(10, { scope: "public" });
    expect(runs).toEqual([expect.objectContaining({ runId, visibility: "public" })]);
  });

  it("with auth off, lists every (ownerless) run for anyone, as before Phase 12", async () => {
    const runs = createMemoryRunRepository();
    await runs.create({ runId, topic: "t", maxDepth: 1, status: "done" });
    expect((await createListRuns({ runs }).execute(10)).runs).toHaveLength(1);
  });
});

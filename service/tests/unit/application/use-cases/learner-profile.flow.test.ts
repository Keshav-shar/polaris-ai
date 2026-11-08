import { describe, expect, it } from "vitest";
import { createFanIn } from "../../../../src/application/tree/fan-in";
import { rootConstructMessage } from "../../../../src/application/tree/messages";
import { createRunFinishedNotifier } from "../../../../src/application/tree/run-finished";
import { createHaltRun } from "../../../../src/application/use-cases/halt-run.use-case";
import type { InsightMessage, LearnerProfile } from "../../../../src/domain/schemas/insight.schema";
import type { NodeContext } from "../../../../src/domain/schemas/node.schema";
import type { NodeMessage } from "../../../../src/domain/schemas/queue-message.schema";
import { createMemoryInsightStore } from "../../../../src/infrastructure/memory/memory-insight.store";
import { createMemoryNodeStateStore } from "../../../../src/infrastructure/memory/memory-node-state.store";
import { createMemoryRunRepository } from "../../../../src/infrastructure/memory/memory-run.repository";
import { createMemoryRunStateStore } from "../../../../src/infrastructure/memory/memory-run-state.store";
import { createMemoryTreeRepository } from "../../../../src/infrastructure/memory/memory-tree.repository";
import { buildHarness } from "../../../fixtures/build-harness";
import { fakeLogger } from "../../../fixtures/fake-generate";

const caller = { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const profile: LearnerProfile = { level: "advanced", preferences: ["shorter"], guidance: "Go deeper." };

async function drain(queue: { receive(max: number): Promise<{ message: NodeMessage }[]> }): Promise<NodeMessage[]> {
  const out: NodeMessage[] = [];
  for (;;) {
    const batch = await queue.receive(10);
    if (batch.length === 0) return out;
    out.push(...batch.map((receipt) => receipt.message));
  }
}

describe("the learner profile rides the build (C139)", () => {
  it("reaches the root call only, and every article message of the build", async () => {
    const insights = createMemoryInsightStore();
    await insights.put({
      userId: caller.userId,
      profile,
      sourceThrough: "2026-11-07T12:00:00.000Z",
      promptVersion: "3",
      updatedAt: "2026-11-07T12:00:00.000Z",
    });
    const contexts: NodeContext[] = [];
    const harness = buildHarness({
      maxDepth: 3,
      insights,
      childrenFor: (topic, context) => (contexts.push(context), [`${topic} a`, `${topic} b`]),
    });
    const { runId } = await harness.startTreeBuild.execute("teach me unix", { caller });
    harness.worker.start();
    await harness.worker.idle();
    await harness.worker.stop();

    // Root first (depth 0), then the interior calls. Only the root carries the profile.
    expect(contexts[0]?.learner).toEqual(profile);
    expect(contexts.length).toBeGreaterThan(1);
    expect(contexts.slice(1).every((context) => context.learner === undefined)).toBe(true);

    const articles = await drain(harness.articleQueue);
    expect(articles.length).toBeGreaterThan(3);
    expect(articles.every((message) => message.runId === runId && message.learner?.level === "advanced")).toBe(true);
  });

  it("builds un-personalised when the insight cannot be read", async () => {
    const harness = buildHarness({
      maxDepth: 1,
      insights: {
        get: async () => {
          throw new Error("database down");
        },
        put: async () => {},
      },
    });
    await harness.startTreeBuild.execute("teach me unix", { caller });
    const [root] = await drain(harness.queue);
    expect(root?.learner).toBeUndefined();
    expect(harness.warnings.map((w) => w.msg)).toContain("learner insight unavailable: building without it");
  });
});

describe("run finished -> insight refresh queued", () => {
  const runId = "11111111-1111-4111-8111-111111111111";

  async function setup(ownerId?: string) {
    const runRepo = createMemoryRunRepository();
    const sent: InsightMessage[] = [];
    const onRunFinished = createRunFinishedNotifier({
      runRepo,
      insightQueue: { send: async (message) => void sent.push(message) },
      logger: fakeLogger().logger,
    });
    await runRepo.create({
      runId,
      topic: "Unix",
      maxDepth: 1,
      status: "constructed",
      ...(ownerId === undefined ? {} : { ownerId, visibility: "private" as const }),
    });
    return { runRepo, sent, onRunFinished };
  }

  it("queues exactly one refresh when an owned run reaches done, and none on a redelivered article", async () => {
    const { runRepo, sent, onRunFinished } = await setup(caller.userId);
    const nodeState = createMemoryNodeStateStore();
    const runState = createMemoryRunStateStore();
    const treeRepo = createMemoryTreeRepository();
    const fanIn = createFanIn({ nodeState, treeRepo, runState, runRepo, onRunFinished });
    const root = rootConstructMessage(runId, { topic: "Unix", maxDepth: 1, request: "unix" });
    await treeRepo.upsertNode(root, "An OS.");
    await nodeState.claim({ runId, nodeId: root.nodeId, parentId: null, depth: 0 });
    await runState.countNode(runId, "done");
    await nodeState.claimArticle(root.nodeId);

    await fanIn.completeArticle(runId, root.nodeId, "done");
    await fanIn.completeArticle(runId, root.nodeId, "done");
    expect((await runRepo.get(runId))?.status).toBe("done");
    expect(sent).toEqual([{ userId: caller.userId, runId }]);
  });

  it("queues one on a halt, and nothing for an ownerless run", async () => {
    const owned = await setup(caller.userId);
    await createHaltRun({ runRepo: owned.runRepo, logger: fakeLogger().logger, onRunFinished: owned.onRunFinished }).execute(
      runId,
      new Error("quota"),
    );
    expect(owned.sent).toHaveLength(1);

    const ownerless = await setup();
    await ownerless.onRunFinished(runId);
    expect(ownerless.sent).toEqual([]);
  });

  it("never throws when the queue does", async () => {
    const runRepo = createMemoryRunRepository();
    await runRepo.create({ runId, topic: "Unix", maxDepth: 1, status: "done", ownerId: caller.userId, visibility: "private" });
    const { logger, warnings } = fakeLogger();
    const notify = createRunFinishedNotifier({
      runRepo,
      insightQueue: {
        send: async () => {
          throw new Error("queue down");
        },
      },
      logger,
    });
    await expect(notify(runId)).resolves.toBeUndefined();
    expect(warnings.map((w) => w.msg)).toContain("could not queue a learner insight refresh");
  });
});

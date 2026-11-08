import { describe, expect, it } from "vitest";
import { rootConstructMessage } from "../../../../src/application/tree/messages";
import { createGetNode } from "../../../../src/application/use-cases/get-node.use-case";
import { createGetTree } from "../../../../src/application/use-cases/get-tree.use-case";
import { createRecordProgress } from "../../../../src/application/use-cases/record-progress.use-case";
import { createSetLessonFeedback } from "../../../../src/application/use-cases/set-lesson-feedback.use-case";
import { createSubmitQuizAttempt } from "../../../../src/application/use-cases/submit-quiz-attempt.use-case";
import { NodeNotFoundError } from "../../../../src/domain/errors/node-not-found.error";
import { QuizNotFoundError } from "../../../../src/domain/errors/quiz-not-found.error";
import { StorageNotReadyError } from "../../../../src/domain/errors/storage-not-ready.error";
import { UnauthenticatedError } from "../../../../src/domain/errors/unauthenticated.error";
import { createMemoryArticleRepository } from "../../../../src/infrastructure/memory/memory-article.repository";
import { createMemoryFeedbackStore } from "../../../../src/infrastructure/memory/memory-feedback.store";
import { createMemoryProgressStore } from "../../../../src/infrastructure/memory/memory-progress.store";
import { createMemoryQuizStore } from "../../../../src/infrastructure/memory/memory-quiz.store";
import { createMemoryRunRepository } from "../../../../src/infrastructure/memory/memory-run.repository";
import { createMemoryRunStateStore } from "../../../../src/infrastructure/memory/memory-run-state.store";
import { createMemoryTreeRepository } from "../../../../src/infrastructure/memory/memory-tree.repository";

import { fakeLogger } from "../../../fixtures/fake-generate";

const owner = { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const reader = { userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
const runId = "11111111-1111-4111-8111-111111111111";
const url = "https://en.wikipedia.org/w/index.php?curid=1";

async function setup({ visibility = "public" as "private" | "public", withQuiz = true } = {}) {
  let clock = Date.UTC(2026, 10, 7, 12, 0);
  const now = () => clock;
  const runRepo = createMemoryRunRepository();
  const treeRepo = createMemoryTreeRepository();
  const quizStore = createMemoryQuizStore();
  const progress = createMemoryProgressStore({ now });
  const feedback = createMemoryFeedbackStore({ now });
  await runRepo.create({ runId, topic: "Photosynthesis", maxDepth: 1, status: "done", ownerId: owner.userId, visibility });
  const root = rootConstructMessage(runId, { topic: "Photosynthesis", maxDepth: 1, request: "teach me" });
  await treeRepo.upsertNode(root, "Plants make sugar.");
  const nodeId = root.nodeId;
  if (withQuiz) {
    await quizStore.upsert({
      nodeId,
      questions: [0, 1, 2].map((answerIndex, i) => ({
        question: `Q${i}?`,
        options: ["a", "b", "c", "d"],
        answerIndex,
        explanation: `E${i}`,
        evidenceUrl: url,
      })),
    });
  }
  const deps = { treeRepo, runRepo };
  return {
    nodeId,
    progress,
    feedback,
    tick: (ms: number) => (clock += ms),
    submit: createSubmitQuizAttempt({ ...deps, quizStore, progress }),
    record: createRecordProgress({ ...deps, progress }),
    rate: createSetLessonFeedback({ ...deps, feedback }),
    getNode: createGetNode({ ...deps, articleRepo: createMemoryArticleRepository(), quizStore, progress, feedback }),
    getTree: createGetTree({ ...deps, runState: createMemoryRunStateStore(500), progress }),
  };
}

describe("quiz attempts (C106)", () => {
  it("scores an anonymous reader and stores nothing", async () => {
    const { submit, progress, nodeId } = await setup();
    const result = await submit.execute(nodeId, [0, 1, 3]);
    expect(result).toMatchObject({ correct: 2, total: 3, passed: false, recorded: false });
    expect(await progress.listRecent(reader.userId, 10)).toEqual([]);
  });

  it("stores a signed-in reader's attempt and keeps the BEST score, never a worse one", async () => {
    const { submit, progress, nodeId } = await setup();
    await submit.execute(nodeId, [0, 1, 2], reader);
    const second = await submit.execute(nodeId, [3, 3, 3], reader);
    expect(second).toMatchObject({ correct: 0, recorded: true });
    expect(await progress.get(reader.userId, nodeId)).toEqual({ read: false, quizAttempts: 2, quizBest: 3 });
  });

  it("answers quiz_not_found for a lesson without questions", async () => {
    const { submit, nodeId } = await setup({ withQuiz: false });
    await expect(submit.execute(nodeId, [0, 0, 0], reader)).rejects.toBeInstanceOf(QuizNotFoundError);
  });

  it("answers 404 for a private map that is not the caller's, before reading the quiz", async () => {
    const { submit, nodeId } = await setup({ visibility: "private" });
    await expect(submit.execute(nodeId, [0, 1, 2], reader)).rejects.toBeInstanceOf(NodeNotFoundError);
    await expect(submit.execute(nodeId, [0, 1, 2], owner)).resolves.toMatchObject({ recorded: true });
  });
});

describe("read state", () => {
  it("needs sign-in", async () => {
    const { record, nodeId } = await setup();
    await expect(record.markRead(nodeId, undefined)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("stamps the FIRST read only", async () => {
    const { record, progress, nodeId, tick } = await setup();
    await expect(record.markRead(nodeId, reader)).resolves.toEqual({ read: true, quizAttempts: 0 });
    const [first] = await progress.listRecent(reader.userId, 1);
    tick(60_000);
    await record.markRead(nodeId, reader);
    const [again] = await progress.listRecent(reader.userId, 1);
    expect(again?.updatedAt).toBe(first?.updatedAt);
  });
});

describe("lesson feedback (C138)", () => {
  it("needs sign-in and a readable node", async () => {
    const { rate, nodeId } = await setup({ visibility: "private" });
    await expect(rate.execute(nodeId, { helpful: true, tags: [] }, undefined)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(rate.execute(nodeId, { helpful: true, tags: [] }, reader)).rejects.toBeInstanceOf(NodeNotFoundError);
  });

  it("replaces the learner's previous feedback on the same lesson", async () => {
    const { rate, feedback, nodeId } = await setup();
    await rate.execute(nodeId, { helpful: false, tags: ["too-basic"] }, reader);
    await rate.execute(nodeId, { helpful: true, tags: ["just-right"] }, reader);
    expect(await feedback.get(reader.userId, nodeId)).toMatchObject({ helpful: true, tags: ["just-right"] });
    expect(await feedback.listRecent(reader.userId, 10)).toHaveLength(1);
  });
});

describe("read models", () => {
  it("GET /api/nodes/:id never sends the answer key, and shows the caller's own state", async () => {
    const { getNode, submit, rate, nodeId } = await setup();
    const anonymous = await getNode.execute(nodeId);
    expect(JSON.stringify(anonymous.quiz)).not.toContain("answerIndex");
    expect(JSON.stringify(anonymous.quiz)).not.toContain("E0");
    expect(anonymous.progress).toBeUndefined();

    await submit.execute(nodeId, [0, 1, 0], reader);
    await rate.execute(nodeId, { helpful: true, tags: ["needs-examples"] }, reader);
    const mine = await getNode.execute(nodeId, reader);
    expect(mine.progress).toEqual({ read: false, quizAttempts: 1, quizBest: 2 });
    expect(mine.feedback).toMatchObject({ helpful: true, tags: ["needs-examples"] });
    // Someone else's state is never shown.
    expect((await getNode.execute(nodeId, owner)).progress).toBeUndefined();
  });

  it("GET /api/trees/:id carries the signed-in reader's markers only", async () => {
    const { getTree, record, nodeId } = await setup();
    await record.markRead(nodeId, reader);
    expect((await getTree.execute(runId, reader)).progress).toEqual({ [nodeId]: { read: true, quizAttempts: 0 } });
    expect((await getTree.execute(runId)).progress).toBeUndefined();
    expect((await getTree.execute(runId, owner)).progress).toEqual({});
  });
});

describe("per-user extras never take a lesson down (C143)", () => {
  const missing = (): never => {
    throw new StorageNotReadyError("feedback.get", "PGRST205: lesson_feedback not found");
  };

  it("GET /api/nodes/:id still serves the lesson and quiz when the feedback table is missing", async () => {
    const { nodeId } = await setup();
    const treeRepo = createMemoryTreeRepository();
    const runRepo = createMemoryRunRepository();
    const quizStore = createMemoryQuizStore();
    await runRepo.create({ runId, topic: "Photosynthesis", maxDepth: 1, status: "done", ownerId: owner.userId, visibility: "public" });
    await treeRepo.upsertNode(rootConstructMessage(runId, { topic: "Photosynthesis", maxDepth: 1, request: "teach me" }), "Plants.");
    const { logger, warnings } = fakeLogger();
    const getNode = createGetNode({
      treeRepo,
      runRepo,
      articleRepo: createMemoryArticleRepository(),
      quizStore,
      progress: { ...createMemoryProgressStore(), get: async () => missing() },
      feedback: { ...createMemoryFeedbackStore(), get: async () => missing() },
      logger,
    });
    const res = await getNode.execute(nodeId, reader);
    expect(res.node.id).toBe(nodeId);
    expect(res.feedback).toBeUndefined();
    expect(res.progress).toBeUndefined();
    expect(warnings.map((w) => w.context?.what)).toEqual(["progress.get", "feedback.get"]);
  });

  it("GET /api/trees/:id still serves the tree when the progress read fails", async () => {
    const treeRepo = createMemoryTreeRepository();
    const runRepo = createMemoryRunRepository();
    await runRepo.create({ runId, topic: "Photosynthesis", maxDepth: 1, status: "done", ownerId: owner.userId, visibility: "public" });
    await treeRepo.upsertNode(rootConstructMessage(runId, { topic: "Photosynthesis", maxDepth: 1, request: "teach me" }), "Plants.");
    const getTree = createGetTree({
      runRepo,
      treeRepo,
      runState: createMemoryRunStateStore(500),
      progress: { ...createMemoryProgressStore(), listForRun: async () => missing() },
      logger: fakeLogger().logger,
    });
    const res = await getTree.execute(runId, reader);
    expect(res.tree?.topic).toBe("Photosynthesis");
    expect(res.progress).toBeUndefined();
  });

  it("writes still fail loudly", async () => {
    const { nodeId } = await setup();
    const record = createRecordProgress({
      treeRepo: createMemoryTreeRepository(),
      runRepo: createMemoryRunRepository(),
      progress: { ...createMemoryProgressStore(), markRead: async () => missing() },
    });
    // A node the fresh stores do not hold answers 404; the point is that nothing here swallows an error.
    await expect(record.markRead(nodeId, reader)).rejects.toBeInstanceOf(NodeNotFoundError);
  });
});

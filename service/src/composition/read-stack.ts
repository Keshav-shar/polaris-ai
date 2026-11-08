import type { NodeQueuePort } from "../application/ports/node-queue.port";
import type { NodeStatePort } from "../application/ports/node-state.port";
import type { RunStatePort } from "../application/ports/run-state.port";
import { type BoostArticle, createBoostArticle } from "../application/use-cases/boost-article.use-case";
import { createGetNode, type GetNode } from "../application/use-cases/get-node.use-case";
import { createGetTree, type GetTree } from "../application/use-cases/get-tree.use-case";
import { createListRuns, type ListRuns } from "../application/use-cases/list-runs.use-case";
import { createRecordProgress, type RecordProgress } from "../application/use-cases/record-progress.use-case";
import {
  createSetLessonFeedback,
  type SetLessonFeedback,
} from "../application/use-cases/set-lesson-feedback.use-case";
import {
  createSetRunVisibility,
  type SetRunVisibility,
} from "../application/use-cases/set-run-visibility.use-case";
import {
  createStartTreeBuild,
  type StartTreeBuild,
} from "../application/use-cases/start-tree-build.use-case";
import {
  createSubmitQuizAttempt,
  type SubmitQuizAttempt,
} from "../application/use-cases/submit-quiz-attempt.use-case";
import type { Env } from "../config/env";
import { randomUuid } from "../shared/ids";
import type { Logger } from "../shared/logger";
import type { Storage } from "./storage";

// Everything the HTTP API serves that needs NO LLM: kickoff (C100 - it makes no call), the read path and the Phase C
// writes. One wiring for both modes, so the in-process stack and Express-on-Vercel under QUEUE_MODE=sqs cannot
// drift apart (A12).
export type ReadStack = {
  startTreeBuild: StartTreeBuild;
  getTree: GetTree;
  getNode: GetNode;
  boostArticle: BoostArticle;
  listRuns: ListRuns;
  setRunVisibility: SetRunVisibility;
  submitQuizAttempt: SubmitQuizAttempt;
  recordProgress: RecordProgress;
  setLessonFeedback: SetLessonFeedback;
};

export type ReadStackDeps = {
  storage: Storage;
  // Where kickoff and boost send: the construct queue and the article queue.
  queue: NodeQueuePort;
  articleQueue: NodeQueuePort;
  nodeState: NodeStatePort;
  // Absent under QUEUE_MODE=sqs in Express: live stats then come from the rows (A19, C141).
  runState?: RunStatePort | undefined;
  // The pool's requests/day when known, for the over-budget warning at kickoff.
  dailyRequestBudget?: number | undefined;
};

export function createReadStack(env: Env, logger: Logger, deps: ReadStackDeps): ReadStack {
  const { storage, queue, articleQueue, nodeState, runState, dailyRequestBudget } = deps;
  const { runRepo, treeRepo, articleRepo, quizStore } = storage;
  // Postgres mode IS auth mode (C105, C137): a run stored there has an owner, so building needs a signed-in caller
  // and the per-user caps apply; only a signed-in build has a learner to personalise for.
  const authRequired = storage.kind === "postgres";
  return {
    startTreeBuild: createStartTreeBuild({
      // Randomness enters the system here and nowhere else.
      ids: { next: randomUuid },
      runRepo,
      queue,
      logger,
      dailyRequestBudget,
      // Cost guard: MAX_NODES_PER_RUN bounds one run, this bounds how many run at once (C61).
      maxConcurrentRuns: env.MAX_CONCURRENT_RUNS,
      maxNodesPerRun: env.MAX_NODES_PER_RUN,
      users: authRequired
        ? {
            usage: storage.usage,
            maxRunsPerDay: env.MAX_RUNS_PER_USER_PER_DAY,
            maxStoredRuns: env.MAX_STORED_RUNS_PER_USER,
          }
        : undefined,
      insights: authRequired ? storage.insights : undefined,
    }),
    getTree: createGetTree({ runRepo, treeRepo, runState, progress: storage.progress, logger }),
    getNode: createGetNode({
      treeRepo,
      runRepo,
      articleRepo,
      quizStore,
      progress: storage.progress,
      feedback: storage.feedback,
      logger,
    }),
    boostArticle: createBoostArticle({
      treeRepo,
      runRepo,
      nodeState,
      queue,
      articleQueue,
      insights: authRequired ? storage.insights : undefined,
    }),
    listRuns: createListRuns({ runs: runRepo, authRequired }),
    setRunVisibility: createSetRunVisibility({ runRepo }),
    submitQuizAttempt: createSubmitQuizAttempt({ treeRepo, runRepo, quizStore, progress: storage.progress }),
    recordProgress: createRecordProgress({ treeRepo, runRepo, progress: storage.progress }),
    setLessonFeedback: createSetLessonFeedback({ treeRepo, runRepo, feedback: storage.feedback }),
  };
}

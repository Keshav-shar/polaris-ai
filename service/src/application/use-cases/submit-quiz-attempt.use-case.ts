import { scoreAttempt } from "../../domain/entities/quiz-scoring";
import { QuizNotFoundError } from "../../domain/errors/quiz-not-found.error";
import type { Caller } from "../../domain/schemas/caller.schema";
import type { QuizAttemptResponse } from "../../domain/schemas/progress.schema";
import type { ProgressPort } from "../ports/progress.port";
import type { QuizStorePort } from "../ports/quiz-store.port";
import type { RunRepositoryPort } from "../ports/run-repository.port";
import type { TreeRepositoryPort } from "../ports/tree-repository.port";
import { readableNode } from "../tree/readable-node";

export type SubmitQuizAttempt = {
  execute(nodeId: string, answers: readonly number[], caller?: Caller): Promise<QuizAttemptResponse>;
};

// POST /api/nodes/:nodeId/quiz-attempts (C106). Scored here, never in the browser, so the answer key is first sent
// in this response. Anyone who may read the node may answer; only a signed-in caller's attempt is stored - an
// anonymous reader still learns their score, and nothing is kept.
export function createSubmitQuizAttempt(deps: {
  treeRepo: TreeRepositoryPort;
  runRepo: RunRepositoryPort;
  quizStore: QuizStorePort;
  progress: ProgressPort;
}): SubmitQuizAttempt {
  return {
    async execute(nodeId, answers, caller) {
      const { node } = await readableNode(deps, nodeId, caller);
      const quiz = await deps.quizStore.get(nodeId);
      if (quiz === undefined) throw new QuizNotFoundError(nodeId);
      const scored = scoreAttempt(quiz.questions, answers);
      if (caller === undefined) return { ...scored, recorded: false };
      await deps.progress.recordQuizAttempt(
        { userId: caller.userId, nodeId, runId: node.runId },
        scored.correct,
        answers,
      );
      return { ...scored, recorded: true };
    },
  };
}

import type { QuizStorePort } from "../../application/ports/quiz-store.port";
import type { Quiz } from "../../domain/schemas/quiz.schema";

export function createMemoryQuizStore(): QuizStorePort {
  const quizzes = new Map<string, Quiz>();

  const copy = (quiz: Quiz): Quiz => ({
    ...quiz,
    questions: quiz.questions.map((q) => ({ ...q, options: [...q.options] })),
  });

  return {
    async upsert(quiz: Quiz) {
      quizzes.set(quiz.nodeId, copy(quiz));
    },
    async get(nodeId: string) {
      const quiz = quizzes.get(nodeId);
      return quiz === undefined ? undefined : copy(quiz);
    },
  };
}

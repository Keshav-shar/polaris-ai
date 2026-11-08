import { QUIZ_CONFIG } from "../../config/constants";
import type { QuizAttemptResponse } from "../schemas/progress.schema";
import type { PublicQuiz } from "../schemas/progress.schema";
import type { Quiz, QuizQuestion } from "../schemas/quiz.schema";

// Scored by the server (C106): the answer key never leaves the process until an attempt has been made, and the
// response to the attempt is the first place it appears.
export function scoreAttempt(
  questions: readonly QuizQuestion[],
  answers: readonly number[],
): Omit<QuizAttemptResponse, "recorded"> {
  if (answers.length !== questions.length) {
    throw new RangeError(`expected ${questions.length} answers, got ${answers.length}`);
  }
  const results = questions.map((question, i) => {
    const chosenIndex = answers[i] ?? -1;
    return {
      answerIndex: question.answerIndex,
      chosenIndex,
      correct: chosenIndex === question.answerIndex,
      explanation: question.explanation,
      evidenceUrl: question.evidenceUrl,
    };
  });
  const correct = results.filter((result) => result.correct).length;
  const total = questions.length;
  const percent = Math.round((correct / total) * 100);
  return { correct, total, percent, passed: percent >= QUIZ_CONFIG.PASSING_SCORE_PERCENT, results };
}

// What the reader receives before answering: the questions and their options, nothing that gives the answer away.
export function publicQuiz(quiz: Quiz): PublicQuiz {
  return {
    nodeId: quiz.nodeId,
    questions: quiz.questions.map(({ question, options }) => ({ question, options: [...options] })),
  };
}

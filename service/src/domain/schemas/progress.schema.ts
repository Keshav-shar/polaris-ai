// Relative imports only: ui/ type-checks this file, and there `@/` points at ui/src (docs/conflicts.md C41).
import { z } from "zod";
import { QUIZ_CONFIG } from "../../config/constants";
import { QuizQuestion } from "./quiz.schema";

// A question as the reader receives it BEFORE answering (C106): no answerIndex, no explanation. Once scores are
// stored, shipping the key with the question would let any client score itself perfectly.
export const PublicQuizQuestion = QuizQuestion.pick({ question: true, options: true });
export type PublicQuizQuestion = z.infer<typeof PublicQuizQuestion>;

export const PublicQuiz = z.object({
  nodeId: z.uuid(),
  questions: z.array(PublicQuizQuestion).length(QUIZ_CONFIG.QUESTIONS_PER_TOPIC),
});
export type PublicQuiz = z.infer<typeof PublicQuiz>;

const OptionIndex = QuizQuestion.shape.answerIndex;

// POST /api/nodes/:nodeId/quiz-attempts. One chosen option per question, in question order.
export const QuizAttemptBody = z.strictObject({
  answers: z.array(OptionIndex).length(QUIZ_CONFIG.QUESTIONS_PER_TOPIC),
});
export type QuizAttemptBody = z.infer<typeof QuizAttemptBody>;

export const QuizAttemptResult = z.object({
  answerIndex: OptionIndex,
  chosenIndex: OptionIndex,
  correct: z.boolean(),
  explanation: z.string(),
  evidenceUrl: QuizQuestion.shape.evidenceUrl,
});
export type QuizAttemptResult = z.infer<typeof QuizAttemptResult>;

export const QuizAttemptResponse = z.object({
  correct: z.number().int().min(0),
  total: z.number().int().min(1),
  percent: z.number().int().min(0).max(100),
  passed: z.boolean(),
  results: z.array(QuizAttemptResult),
  // Whether the attempt was stored: only for a signed-in caller. An anonymous reader is scored and nothing is kept.
  recorded: z.boolean(),
});
export type QuizAttemptResponse = z.infer<typeof QuizAttemptResponse>;

// PUT /api/nodes/:nodeId/progress. Only `read: true` exists: "unread" is not something a learner does.
export const ProgressBody = z.strictObject({ read: z.literal(true) });
export type ProgressBody = z.infer<typeof ProgressBody>;

// One learner's state on one node, from node_progress (C106).
export const NodeProgress = z.object({
  read: z.boolean(),
  quizAttempts: z.number().int().min(0),
  // Best number of questions answered correctly, absent until the first attempt.
  quizBest: z.number().int().min(0).max(QUIZ_CONFIG.QUESTIONS_PER_TOPIC).optional(),
});
export type NodeProgress = z.infer<typeof NodeProgress>;

// What GET /api/trees/:runId adds for a signed-in reader: their progress keyed by node id, only for nodes touched.
export const RunProgress = z.record(z.uuid(), NodeProgress);
export type RunProgress = z.infer<typeof RunProgress>;

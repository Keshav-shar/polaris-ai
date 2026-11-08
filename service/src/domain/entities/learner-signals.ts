import { QUIZ_CONFIG } from "../../config/constants";
import { FeedbackTag, type LessonFeedback } from "../schemas/feedback.schema";
import type { NodeProgress } from "../schemas/progress.schema";

// One row of a learner's history, as the insight job reads it: what they said about a lesson and how they did
// on its quiz. Either half may be missing for a node.
export type FeedbackSignal = Pick<LessonFeedback, "helpful" | "tags" | "updatedAt">;
export type ProgressSignal = NodeProgress & { updatedAt: string };

// Everything the insight call is shown: counts and enums, never text a learner typed (C138, C139). That is why
// the call needs no injection defence beyond the data block it already gets.
export type LearnerSignals = {
  // Feedback rows + quiz-attempted lessons: the number INSIGHT.MIN_SIGNALS is compared with.
  signals: number;
  feedbackGiven: number;
  helpful: number;
  notHelpful: number;
  tags: Record<FeedbackTag, number>;
  lessonsRead: number;
  quizzesTaken: number;
  // Mean of each quizzed lesson's BEST score, as a percentage; null when no quiz was taken.
  quizMeanPercent: number | null;
  // The newest updatedAt among the inputs: what the stored insight records as `sourceThrough`.
  newest: string | undefined;
};

// Parsed, not compared as text: Postgres and the memory stores spell the same instant differently.
const later = (a: string | undefined, b: string): string =>
  a === undefined || Date.parse(b) > Date.parse(a) ? b : a;

export function summarizeSignals(
  feedback: readonly FeedbackSignal[],
  progress: readonly ProgressSignal[],
): LearnerSignals {
  const tags = Object.fromEntries(FeedbackTag.options.map((tag) => [tag, 0])) as Record<FeedbackTag, number>;
  let helpful = 0;
  let notHelpful = 0;
  let newest: string | undefined;
  for (const row of feedback) {
    if (row.helpful === true) helpful += 1;
    if (row.helpful === false) notHelpful += 1;
    for (const tag of row.tags) tags[tag] += 1;
    newest = later(newest, row.updatedAt);
  }

  let lessonsRead = 0;
  let quizzesTaken = 0;
  let bestSum = 0;
  for (const row of progress) {
    if (row.read) lessonsRead += 1;
    if (row.quizAttempts > 0 && row.quizBest !== undefined) {
      quizzesTaken += 1;
      bestSum += row.quizBest;
    }
    newest = later(newest, row.updatedAt);
  }

  return {
    signals: feedback.length + quizzesTaken,
    feedbackGiven: feedback.length,
    helpful,
    notHelpful,
    tags,
    lessonsRead,
    quizzesTaken,
    quizMeanPercent:
      quizzesTaken === 0 ? null : Math.round((bestSum / (quizzesTaken * QUIZ_CONFIG.QUESTIONS_PER_TOPIC)) * 100),
    newest,
  };
}

// Whether anything happened after the stored insight was computed.
export function hasNewSignals(
  feedback: readonly Pick<FeedbackSignal, "updatedAt">[],
  progress: readonly Pick<ProgressSignal, "updatedAt">[],
  sourceThrough: string | undefined,
): boolean {
  if (sourceThrough === undefined) return feedback.length + progress.length > 0;
  const since = Date.parse(sourceThrough);
  return [...feedback, ...progress].some((row) => Date.parse(row.updatedAt) > since);
}

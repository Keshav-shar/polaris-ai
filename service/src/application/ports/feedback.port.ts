import type { FeedbackSignal } from "../../domain/entities/learner-signals";
import type { LessonFeedback, LessonFeedbackBody } from "../../domain/schemas/feedback.schema";
import type { ProgressKey } from "./progress.port";

// A learner's tags on a lesson (C138): one row per (user, node), replaced on every save. Postgres
// `lesson_feedback` (0013), in memory for tests.
export type FeedbackPort = {
  upsert(key: ProgressKey, feedback: LessonFeedbackBody): Promise<LessonFeedback>;
  get(userId: string, nodeId: string): Promise<LessonFeedback | undefined>;
  // Newest first, at most `limit`: the insight job's input.
  listRecent(userId: string, limit: number): Promise<FeedbackSignal[]>;
};

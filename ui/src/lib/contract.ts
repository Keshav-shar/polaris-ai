// The single file allowed to import from service/src, and only types: no Zod or runtime code reaches the browser.
export type {
  ApiError,
  HealthResponse,
  NodeResponse,
  RunsResponse,
  RunSummary,
  StartTreeResponse,
  TreeRequestBody,
  TreeResponse,
  VisibilityResponse,
} from "@service/domain/schemas/api.schema";
export type { Article } from "@service/domain/schemas/article.schema";
export type { Quiz, QuizQuestion } from "@service/domain/schemas/quiz.schema";
// Phase C (C106, C138): what the reader sees before answering, what an attempt returns, and lesson feedback.
export type {
  NodeProgress,
  PublicQuiz,
  PublicQuizQuestion,
  QuizAttemptResponse,
  QuizAttemptResult,
  RunProgress,
} from "@service/domain/schemas/progress.schema";
export type { FeedbackTag, LessonFeedback, LessonFeedbackBody } from "@service/domain/schemas/feedback.schema";
export type { ArticleWriteStatus, TreeNode, TreeNodeStatus } from "@service/domain/schemas/node.schema";
// Phase 8 polls until the run leaves `constructing`; `halted` is terminal too, or the UI polls forever.
export type { RunStatus, RunVisibility } from "@service/domain/schemas/run.schema";

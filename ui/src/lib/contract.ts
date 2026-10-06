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
} from "@service/domain/schemas/api.schema";
export type { Article } from "@service/domain/schemas/article.schema";
export type { Quiz, QuizQuestion } from "@service/domain/schemas/quiz.schema";
export type { ArticleWriteStatus, TreeNode, TreeNodeStatus } from "@service/domain/schemas/node.schema";
// Phase 8 polls until the run leaves `constructing`; `halted` is terminal too, or the UI polls forever.
export type { RunStatus } from "@service/domain/schemas/run.schema";

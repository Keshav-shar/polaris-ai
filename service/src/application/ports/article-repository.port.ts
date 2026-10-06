import type { Article } from "../../domain/schemas/article.schema";

// The permanent article store: in memory now, Postgres `articles` from Phase 12 (one row per node).
export type ArticleRepositoryPort = {
  // Rule 6: an upsert keyed on nodeId, so a redelivered article message rewrites the same row.
  upsert(article: Article): Promise<void>;
  get(nodeId: string): Promise<Article | undefined>;
};

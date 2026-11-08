import type { ArticleDraftPort } from "../application/ports/article-draft.port";
import type { ArticleRepositoryPort } from "../application/ports/article-repository.port";
import type { EvidenceRepositoryPort } from "../application/ports/evidence-repository.port";
import type { ExpansionCachePort } from "../application/ports/expansion-cache.port";
import type { FeedbackPort } from "../application/ports/feedback.port";
import type { InsightPort } from "../application/ports/insight.port";
import type { ProgressPort } from "../application/ports/progress.port";
import type { QuizStorePort } from "../application/ports/quiz-store.port";
import type { RunRepositoryPort } from "../application/ports/run-repository.port";
import type { TreeRepositoryPort } from "../application/ports/tree-repository.port";
import type { UsagePort } from "../application/ports/usage.port";
import { type Env, supabaseEnv } from "../config/env";
import { createMemoryArticleDraftStore } from "../infrastructure/memory/memory-article-draft.store";
import { createMemoryArticleRepository } from "../infrastructure/memory/memory-article.repository";
import { createMemoryEvidenceRepository } from "../infrastructure/memory/memory-evidence.repository";
import { createMemoryExpansionCache } from "../infrastructure/memory/memory-expansion-cache.store";
import { createMemoryFeedbackStore } from "../infrastructure/memory/memory-feedback.store";
import { createMemoryInsightStore } from "../infrastructure/memory/memory-insight.store";
import { createMemoryProgressStore } from "../infrastructure/memory/memory-progress.store";
import { createMemoryQuizStore } from "../infrastructure/memory/memory-quiz.store";
import { createMemoryRunRepository } from "../infrastructure/memory/memory-run.repository";
import { createMemoryTreeRepository } from "../infrastructure/memory/memory-tree.repository";
import { createMemoryUsageStore } from "../infrastructure/memory/memory-usage.store";
import { createPostgresArticleDraftRepository } from "../infrastructure/postgres/article-draft.repository";
import { createPostgresArticleRepository } from "../infrastructure/postgres/article.repository";
import { createPostgresEvidenceRepository } from "../infrastructure/postgres/evidence.repository";
import { createPostgresExpansionCache } from "../infrastructure/postgres/expansion-cache.store";
import { createPostgresFeedbackRepository } from "../infrastructure/postgres/feedback.repository";
import { createPostgresInsightRepository } from "../infrastructure/postgres/insight.repository";
import { createPostgresProgressRepository } from "../infrastructure/postgres/progress.repository";
import { createPostgresQuizStore } from "../infrastructure/postgres/quiz.repository";
import { createPostgresRunRepository } from "../infrastructure/postgres/run.repository";
import { probeSchema } from "../infrastructure/postgres/schema-probe";
import { createSupabaseServiceClient } from "../infrastructure/postgres/supabase.client";
import { createPostgresTreeRepository } from "../infrastructure/postgres/tree.repository";
import { createPostgresUsageStore } from "../infrastructure/postgres/usage.store";

// The PERMANENT stores, one instance of each per process: the writer and the reader must share them, or the API
// would read from a store nothing ever wrote to. The in-flight stores (node state, run state, dedup) are not here:
// they stay in memory until Phase 13 moves them to DynamoDB.
export type Storage = {
  kind: "postgres" | "memory";
  // Postgres: every table / late column that is missing (C143), for the startup check. Memory: always [].
  probeSchema(): Promise<string[]>;
  runRepo: RunRepositoryPort;
  treeRepo: TreeRepositoryPort;
  articleRepo: ArticleRepositoryPort;
  evidenceRepo: EvidenceRepositoryPort;
  quizStore: QuizStorePort;
  expansionCache: ExpansionCachePort;
  usage: UsagePort;
  // Per-learner state (Phase C, C106, C138, C139): read progress + quiz results, lesson feedback, the insight.
  progress: ProgressPort;
  feedback: FeedbackPort;
  insights: InsightPort;
  // The writer's stored draft when node state lives in DynamoDB (A14, A23). The memory node-state store keeps the
  // draft on its own item and never reads this.
  articleDrafts: ArticleDraftPort;
};

export function createMemoryStorage(): Storage {
  return {
    kind: "memory",
    probeSchema: async () => [],
    runRepo: createMemoryRunRepository(),
    treeRepo: createMemoryTreeRepository(),
    articleRepo: createMemoryArticleRepository(),
    evidenceRepo: createMemoryEvidenceRepository(),
    quizStore: createMemoryQuizStore(),
    expansionCache: createMemoryExpansionCache(),
    usage: createMemoryUsageStore(),
    progress: createMemoryProgressStore(),
    feedback: createMemoryFeedbackStore(),
    insights: createMemoryInsightStore(),
    articleDrafts: createMemoryArticleDraftStore(),
  };
}

// Postgres when Supabase is configured (C107, C137), memory otherwise. Builds no connection: supabase-js is HTTPS
// per call, so constructing it is free and a missing network only shows on the first query.
export function createStorageFromEnv(env: Env): Storage {
  const supabase = supabaseEnv(env);
  if (supabase === undefined) return createMemoryStorage();
  const db = createSupabaseServiceClient(supabase);
  return {
    kind: "postgres",
    probeSchema: () => probeSchema(db),
    runRepo: createPostgresRunRepository(db),
    treeRepo: createPostgresTreeRepository(db),
    articleRepo: createPostgresArticleRepository(db),
    evidenceRepo: createPostgresEvidenceRepository(db),
    quizStore: createPostgresQuizStore(db),
    expansionCache: createPostgresExpansionCache(db),
    usage: createPostgresUsageStore(db),
    progress: createPostgresProgressRepository(db),
    feedback: createPostgresFeedbackRepository(db),
    insights: createPostgresInsightRepository(db),
    articleDrafts: createPostgresArticleDraftRepository(db),
  };
}

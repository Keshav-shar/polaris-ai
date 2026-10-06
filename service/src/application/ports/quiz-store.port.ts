import type { Quiz } from "../../domain/schemas/quiz.schema";

// The node's questions. Generated inside the writer's own call rather than on demand (docs/conflicts.md
// C74), but stored SEPARATELY from the article so the shape still matches the planned Postgres tables
// (`0005_articles`, `0006_quizzes` - a node has at most one of each).
//
// A node can legitimately have an article and NO quiz: every question must cite an evidence url, so a node
// whose credibility gate found no credible source cannot have questions at all (C80).
export type QuizStorePort = {
  upsert(quiz: Quiz): Promise<void>;
  get(nodeId: string): Promise<Quiz | undefined>;
};

import type { ArticleDraft } from "../../domain/schemas/article.schema";

// The writer's stored result for idempotency rule 2, kept OUT of the node item on AWS (A14 -> A23): a 3-9 KB draft
// would cost up to 9 WCU per UpdateItem against 5 provisioned. Postgres `article_drafts` (0016). The DynamoDB
// node-state store reads and writes drafts through this port, so the NodeStatePort contract does not change.
export type ArticleDraftPort = {
  get(nodeId: string): Promise<ArticleDraft | undefined>;
  // Write-once: an existing draft is returned unchanged, so two deliveries can never store different articles.
  putIfAbsent(nodeId: string, draft: ArticleDraft): Promise<ArticleDraft>;
};

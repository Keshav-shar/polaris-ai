import type { ArticleDraftPort } from "../../application/ports/article-draft.port";
import type { ArticleDraft } from "../../domain/schemas/article.schema";

// article_drafts in memory: write-once per node. Used with the DynamoDB node-state store when the permanent stores
// are in memory (the single-process AWS smoke run); the memory node-state store keeps drafts on the item instead.
export function createMemoryArticleDraftStore(): ArticleDraftPort {
  const drafts = new Map<string, ArticleDraft>();
  const copy = (draft: ArticleDraft): ArticleDraft => structuredClone(draft);
  return {
    async get(nodeId) {
      const draft = drafts.get(nodeId);
      return draft === undefined ? undefined : copy(draft);
    },
    async putIfAbsent(nodeId, draft) {
      if (!drafts.has(nodeId)) drafts.set(nodeId, copy(draft));
      return copy(drafts.get(nodeId) as ArticleDraft);
    },
  };
}

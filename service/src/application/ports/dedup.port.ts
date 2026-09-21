// Exact, tree-wide topic dedup for one run. Semantic dedup (pgvector) is deferred.
export type DedupPort = {
  // Rule 7. Claims each topic under `dedup#<runId>#<normalizeTopic(topic)>`, keeping it when the key is
  // free OR already held by this same claimant - so a retried parent keeps the topics it already claimed
  // instead of losing them to itself. Returns the ORIGINAL topic strings that were claimed, in input order.
  claimTopics(runId: string, claimantParentId: string, topics: readonly string[]): Promise<string[]>;
};

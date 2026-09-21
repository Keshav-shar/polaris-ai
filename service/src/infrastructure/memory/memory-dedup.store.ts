import type { DedupPort } from "../../application/ports/dedup.port";
import { normalizeTopic } from "../../domain/traversal/node-id";

// Same atomicity contract as memory-node-state.store.ts: no await between read and write.
export function createMemoryDedupStore(): DedupPort {
  // key -> claimantParentId
  const claims = new Map<string, string>();

  return {
    async claimTopics(runId, claimantParentId, topics) {
      const kept: string[] = [];
      for (const topic of topics) {
        const key = `dedup#${runId}#${normalizeTopic(topic)}`;
        const owner = claims.get(key);
        // Rule 7: free, or already ours. The second half is what lets a retried parent keep the topics it
        // claimed on its first attempt instead of losing them to itself.
        if (owner === undefined || owner === claimantParentId) {
          claims.set(key, claimantParentId);
          kept.push(topic);
        }
      }
      return kept;
    },
  };
}

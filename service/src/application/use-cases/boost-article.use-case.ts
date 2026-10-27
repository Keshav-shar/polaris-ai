import { NodeNotFoundError } from "../../domain/errors/node-not-found.error";
import type { BoostResponse } from "../../domain/schemas/api.schema";
import type { AncestorRef } from "../../domain/schemas/node.schema";
import type { NodeQueuePort } from "../ports/node-queue.port";
import type { NodeStatePort } from "../ports/node-state.port";
import type { RunRepositoryPort } from "../ports/run-repository.port";
import type { StoredNode, TreeRepositoryPort } from "../ports/tree-repository.port";
import { rebuildMessage } from "../tree/messages";

export type BoostArticleDeps = {
  treeRepo: TreeRepositoryPort;
  runRepo: RunRepositoryPort;
  nodeState: NodeStatePort;
  // Construction's queue: a node that is not expanded yet has its construct message promoted too.
  queue: NodeQueuePort;
  articleQueue: NodeQueuePort;
};

export type BoostArticle = {
  execute(nodeId: string): Promise<BoostResponse>;
};

// POST /api/nodes/:nodeId/boost (C128): a learner is waiting on this scroll, so its waiting work goes first.
// It never spends an LLM call and never adds a message - it reorders what is already queued and records the
// wish for a message that does not exist yet. Idempotent: boosting twice changes nothing more.
export function createBoostArticle({ treeRepo, runRepo, nodeState, queue, articleQueue }: BoostArticleDeps): BoostArticle {
  // The node's nearest ancestors, oldest first, as its messages carry them (ANCESTOR_WINDOW levels).
  const lineageOf = async (node: StoredNode): Promise<AncestorRef[]> => {
    const parent = node.parentId === null ? undefined : await treeRepo.getNode(node.parentId);
    if (parent === undefined) return [];
    const grandparent = parent.parentId === null ? undefined : await treeRepo.getNode(parent.parentId);
    const ref = (row: StoredNode): AncestorRef => ({ depth: row.depth, topic: row.topic, brief: row.brief });
    return grandparent === undefined ? [ref(parent)] : [ref(grandparent), ref(parent)];
  };

  return {
    async execute(nodeId) {
      const node = await treeRepo.getNode(nodeId);
      if (node === undefined) throw new NodeNotFoundError(nodeId);
      const answer = (status: BoostResponse["status"]): BoostResponse => ({ nodeId, status });

      if (node.articleStatus === "done") return answer("written");
      // A node whose construction failed never gets an article, so there is nothing to hurry.
      if (node.articleStatus === "failed" || node.status === "failed") return answer("failed");

      const run = await runRepo.get(node.runId);
      if (run === undefined) throw new NodeNotFoundError(nodeId);
      const lineage = await lineageOf(node);

      // Recorded FIRST: if this node is being expanded right now, its article message is sent after this
      // write and goes out boosted. A node with no state yet (unreachable in practice) simply is not marked.
      await nodeState.markBoosted(nodeId);

      const article = await articleQueue.promote(rebuildMessage("article", node, lineage, run.maxDepth));
      if (article === "promoted") return answer("promoted");

      if (node.status === "pending") {
        // Not the root: a rebuilt root message has no raw request, so it must never be sent anywhere. The root
        // is the first node built, so it is never usefully pending by the time a learner can boost it.
        if (node.parentId !== null) await queue.promote(rebuildMessage("construct", node, lineage, run.maxDepth));
        return answer("awaiting-construction");
      }
      // Expanded, not written, and nothing waiting: its article is in flight or between attempts.
      return answer("writing");
    },
  };
}

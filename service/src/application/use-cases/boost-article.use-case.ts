import { canReadRun } from "../../domain/entities/run-access";
import { NodeNotFoundError } from "../../domain/errors/node-not-found.error";
import type { BoostResponse } from "../../domain/schemas/api.schema";
import type { Caller } from "../../domain/schemas/caller.schema";
import type { AncestorRef } from "../../domain/schemas/node.schema";
import type { NodeQueuePort } from "../ports/node-queue.port";
import type { NodeStatePort } from "../ports/node-state.port";
import type { RunRepositoryPort } from "../ports/run-repository.port";
import type { StoredNode, TreeRepositoryPort } from "../ports/tree-repository.port";
import type { InsightPort } from "../ports/insight.port";
import { rebuildMessage } from "../tree/messages";
import { optionalRead } from "../tree/optional-read";

export type BoostArticleDeps = {
  treeRepo: TreeRepositoryPort;
  runRepo: RunRepositoryPort;
  nodeState: NodeStatePort;
  // Construction's queue: a node that is not expanded yet has its construct message promoted too.
  queue: NodeQueuePort;
  articleQueue: NodeQueuePort;
  // The owner's learner profile, re-attached to a rebuilt article message (A24): on SQS a boost SENDS that rebuilt
  // copy, and rows do not carry the profile the build started with. Absent = never personalised.
  insights?: InsightPort | undefined;
};

export type BoostArticle = {
  // Anyone who may READ the run may hurry its scroll: it reorders queued work and costs nothing (C128). Anyone
  // else gets the same 404 as for an unknown node (C105).
  execute(nodeId: string, caller?: Caller): Promise<BoostResponse>;
};

// POST /api/nodes/:nodeId/boost (C128): a learner is waiting on this scroll, so its waiting work goes first.
// It never spends an LLM call and never adds a message - it reorders what is already queued and records the
// wish for a message that does not exist yet. Idempotent: boosting twice changes nothing more.
export function createBoostArticle({
  treeRepo,
  runRepo,
  nodeState,
  queue,
  articleQueue,
  insights,
}: BoostArticleDeps): BoostArticle {
  // The node's nearest ancestors, oldest first, as its messages carry them (ANCESTOR_WINDOW levels).
  const lineageOf = async (node: StoredNode): Promise<AncestorRef[]> => {
    const parent = node.parentId === null ? undefined : await treeRepo.getNode(node.parentId);
    if (parent === undefined) return [];
    const grandparent = parent.parentId === null ? undefined : await treeRepo.getNode(parent.parentId);
    const ref = (row: StoredNode): AncestorRef => ({ depth: row.depth, topic: row.topic, brief: row.brief });
    return grandparent === undefined ? [ref(parent)] : [ref(grandparent), ref(parent)];
  };

  return {
    async execute(nodeId, caller) {
      const node = await treeRepo.getNode(nodeId);
      if (node === undefined) throw new NodeNotFoundError(nodeId);
      const run = await runRepo.get(node.runId);
      if (run === undefined || !canReadRun(run, caller)) throw new NodeNotFoundError(nodeId);
      const answer = (status: BoostResponse["status"]): BoostResponse => ({ nodeId, status });

      if (node.articleStatus === "done") return answer("written");
      // A node whose construction failed never gets an article, so there is nothing to hurry.
      if (node.articleStatus === "failed" || node.status === "failed") return answer("failed");

      const lineage = await lineageOf(node);

      // Recorded FIRST: if this node is being expanded right now, its article message is sent after this
      // write and goes out boosted. A node with no state yet (unreachable in practice) simply is not marked.
      await nodeState.markBoosted(nodeId);

      if (node.status === "pending") {
        // Not the root: a rebuilt root message has no raw request, so it must never be sent anywhere. The root
        // is the first node built, so it is never usefully pending by the time a learner can boost it.
        if (node.parentId !== null) await queue.promote(rebuildMessage("construct", node, lineage, run.maxDepth));
        return answer("awaiting-construction");
      }
      // Only once the node is expanded does its article message exist. Promoting earlier would, on SQS (where a
      // promote SENDS a copy), deliver an article for a node with no state - three failures and a lost scroll.
      const rebuilt = rebuildMessage("article", node, lineage, run.maxDepth);
      const learner =
        insights === undefined || run.ownerId === undefined
          ? undefined
          : await optionalRead(insights.get(run.ownerId), undefined, "insights.get").then((row) => row?.profile);
      const article = await articleQueue.promote(learner === undefined ? rebuilt : { ...rebuilt, learner });
      if (article === "promoted") return answer("promoted");
      // Expanded, not written, and nothing waiting: its article is in flight or between attempts.
      return answer("writing");
    },
  };
}

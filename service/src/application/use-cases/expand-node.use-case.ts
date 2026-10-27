import { ConstructionRejectedError } from "../../domain/errors/construction-rejected.error";
import type { ChildDraft } from "../../domain/schemas/node.schema";
import type { NodeMessage } from "../../domain/schemas/queue-message.schema";
import { branchCap } from "../../domain/traversal/branch-cap";
import { layerPosition } from "../../domain/traversal/layer-position";
import type { Logger } from "../../shared/logger";
import type { DedupPort } from "../ports/dedup.port";
import type { NodeQueuePort } from "../ports/node-queue.port";
import type { NodeResult, NodeStatePort } from "../ports/node-state.port";
import type { RunRepositoryPort } from "../ports/run-repository.port";
import type { RunStatePort } from "../ports/run-state.port";
import type { TreeRepositoryPort } from "../ports/tree-repository.port";
import type { NodeConstructor } from "../tree/construct-node";
import type { FanIn } from "../tree/fan-in";
import { childConstructMessage, toArticleMessage } from "../tree/messages";

export type ExpandNodeDeps = {
  nodeState: NodeStatePort;
  dedup: DedupPort;
  treeRepo: TreeRepositoryPort;
  // The root call names the run's canonical topic (C100), which is recorded on the run here.
  runRepo: RunRepositoryPort;
  queue: NodeQueuePort;
  // The article queue. An expanded node IS the article pass's trigger, so this node's scroll is written
  // while its children are still being expanded - one downward traversal instead of three (C91).
  articleQueue: NodeQueuePort;
  runState: RunStatePort;
  fanIn: FanIn;
  constructor: NodeConstructor;
  // MAX_NODES_PER_RUN: sets the balanced branch cap, so the budget is spread evenly across branches (C101).
  maxNodesPerRun: number;
  logger: Pick<Logger, "warn">;
};

export type ExpandNode = {
  execute(message: NodeMessage): Promise<void>;
};

// One construct message = one node with a layer beneath it, and ONE LLM call: the call returns this node's
// children together with a brief for each, so a child never spends a call on its own brief and the final
// layer is never called at all - its nodes are created and completed here by their parent (C99). Every step
// is idempotent, because SQS delivers at-least-once and the local worker redelivers on failure; the
// numbered rules are in docs/aws-retrofit.md.
//
// This use-case never catches: an error must reach the worker, or redelivery (and the dead-letter path
// behind it) is defeated.
export function createExpandNode({
  nodeState,
  dedup,
  treeRepo,
  runRepo,
  queue,
  articleQueue,
  runState,
  fanIn,
  constructor,
  maxNodesPerRun,
  logger,
}: ExpandNodeDeps): ExpandNode {
  // Dedup, the balanced branch cap and the run's node budget, in that order. Claimed BEFORE saveResult on
  // purpose: expectedChildren is derived from the stored child set, so trimming afterwards would leave the
  // parent's fan-in waiting forever for children that were never sent (docs/conflicts.md C60).
  const keepChildren = async (message: NodeMessage, drafts: readonly ChildDraft[]): Promise<ChildDraft[]> => {
    const { runId, nodeId, topic, depth, maxDepth } = message;
    if (drafts.length === 0) return [];
    const claimed = new Set(await dedup.claimTopics(runId, nodeId, drafts.map((draft) => draft.topic)));
    const deduped = drafts.filter((draft) => claimed.has(draft.topic));
    if (deduped.length === 0) return [];
    // The balanced cap and the run's budget in one conditional write; whatever either refuses is counted as
    // skipped. Teaching order: the model lists the most fundamental subtopics first, so the cut keeps those.
    const cap = branchCap(maxNodesPerRun, maxDepth);
    const granted = await runState.reserveNodes(runId, deduped.length, cap);
    if (deduped.length > cap) {
      logger.warn("children trimmed to the branch cap", { nodeId, topic, depth, proposed: deduped.length, cap });
    }
    // The budget itself is the backstop: with the cap it binds only when an override changed the arithmetic.
    if (granted < Math.min(cap, deduped.length)) {
      logger.warn("node budget reached: children dropped", {
        nodeId,
        topic,
        depth,
        requested: Math.min(cap, deduped.length),
        granted,
        note: "the tree stops here; the run still completes",
      });
    }
    return deduped.slice(0, granted);
  };

  return {
    async execute(incoming) {
      const { runId, nodeId, parentId, depth, maxDepth, ancestors } = incoming;

      const node = await nodeState.claim({ runId, nodeId, parentId, depth });
      // Rule 1: this node is already finished, so a duplicate delivery does nothing.
      if (node.status === "done" || node.status === "failed") return;

      // From here on the root goes by the topic its own call named, once there is one: a redelivered root
      // must not write the provisional topic (cut from the raw request) back over the canonical one.
      let message: NodeMessage =
        node.result?.topic === undefined ? incoming : { ...incoming, topic: node.result.topic };

      // Before the LLM call, not after: a node whose expansion fails must still appear in the tree under
      // its known topic, or a run that stops early has nothing to show (docs/conflicts.md C54). A null
      // brief never overwrites one already stored, so this stays a Rule 6 upsert.
      await treeRepo.upsertNode(message, null);

      // A learner boosted this node while its article message did not exist yet (C128). Read from the freshest
      // state this delivery holds; a promoted construct message carries `boost` itself, which
      // toArticleMessage keeps.
      let boosted = node.boosted === true;
      const ownArticle = (m: NodeMessage): NodeMessage =>
        boosted ? { ...toArticleMessage(m), boost: true } : toArticleMessage(m);

      let result: NodeResult | undefined = node.result;
      if (result === undefined) {
        const position = layerPosition(depth, maxDepth);
        if (position === "leaf") {
          // Not reached in a normal build - the final layer is completed by its parent - but a leaf message
          // that does arrive is answered from the brief it carries, never with a call.
          if (message.brief === undefined) throw new ConstructionRejectedError("leaf message without a brief");
          result = { brief: message.brief, children: [] };
        } else {
          const output = await constructor.construct({
            topic: message.topic,
            brief: message.brief,
            request: message.request,
            context: { depth, maxDepth, position, ancestors },
            seedKey: nodeId,
          });
          const brief = output.brief ?? message.brief;
          if (brief === undefined) throw new ConstructionRejectedError("no brief for this node");
          const children = await keepChildren(message, output.children);
          result = { ...(output.topic === undefined ? {} : { topic: output.topic }), brief, children };
        }
        // Rule 2 + 3: stored before any side effect, and the STORED value is what we go on to use, so a
        // concurrent delivery that got there first wins and both agree on the child set.
        const saved = await nodeState.saveResult(nodeId, result);
        boosted ||= saved.boosted === true;
        result = saved.result;
        if (result === undefined) throw new Error(`saveResult left node ${nodeId} without a result`);
      }

      if (result.topic !== undefined) {
        // Every delivery, not just the first: a crash between saveResult and here must not leave the run
        // titled with the provisional topic. Idempotent, and only the root ever has a `topic`.
        message = { ...message, topic: result.topic };
        await runRepo.setTopic(runId, result.topic);
      }
      // Rule 6: an upsert, so a redelivery rewrites the same row.
      await treeRepo.upsertNode(message, result.brief);

      if (result.children.length === 0) {
        // Nothing below it to wait for, so its scroll can be written at once.
        await articleQueue.send(ownArticle(message));
        await fanIn.completeConstruction(nodeId, "done");
        return;
      }

      const parentBrief = result.brief;
      const childMessages = result.children.map((child) => childConstructMessage(message, parentBrief, child));
      // Rule 4 before the sends: a child that completes fast must find its own state already there.
      await nodeState.createPending(childMessages);
      // The frontier is known now, so show it - with each child's brief, which its parent just wrote. These
      // rows are also what the writer reads to signpost this node's subtopics, which is why they are upserted
      // BEFORE the article message goes out.
      await treeRepo.upsertPending(childMessages);

      if (depth + 1 >= maxDepth) {
        // The children are the FINAL layer: everything they need - topic and brief - is already written, so
        // they are never sent to construction and never cost a call (C99). Their articles go out with this
        // node's, then each is completed here; the last one completes this node through the ordinary fan-in.
        // Redelivery-safe: claimArticle absorbs a re-sent article and `finish` refuses a second completion.
        await articleQueue.sendBatch([ownArticle(message), ...childMessages.map(toArticleMessage)]);
        for (const child of childMessages) await fanIn.completeConstruction(child.nodeId, "done");
        return;
      }

      // The hand-off to the second pass, one node at a time: this node's brief is durable and its children's
      // topics and briefs are on their rows, so everything the writer needs exists. The article is then
      // written in parallel with the children's expansion (C91). A redelivery re-sends it; claimArticle
      // absorbs that.
      await articleQueue.send(ownArticle(message));
      await queue.sendBatch(childMessages);
    },
  };
}

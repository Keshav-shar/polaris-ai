import type { NodeMessage } from "../../domain/schemas/queue-message.schema";
import { layerPosition } from "../../domain/traversal/layer-position";
import type { Logger } from "../../shared/logger";
import type { DedupPort } from "../ports/dedup.port";
import type { NodeQueuePort } from "../ports/node-queue.port";
import type { NodeStatePort } from "../ports/node-state.port";
import type { RunStatePort } from "../ports/run-state.port";
import type { TreeRepositoryPort } from "../ports/tree-repository.port";
import type { NodeConstructor } from "../tree/construct-node";
import type { FanIn } from "../tree/fan-in";
import { childConstructMessage, toArticleMessage } from "../tree/messages";

export type ExpandNodeDeps = {
  nodeState: NodeStatePort;
  dedup: DedupPort;
  treeRepo: TreeRepositoryPort;
  queue: NodeQueuePort;
  // The article queue. An expanded node IS the article pass's trigger, so this node's scroll is written
  // while its children are still being expanded - one downward traversal instead of three (C91).
  articleQueue: NodeQueuePort;
  runState: RunStatePort;
  fanIn: FanIn;
  constructor: NodeConstructor;
  logger: Pick<Logger, "warn">;
};

export type ExpandNode = {
  execute(message: NodeMessage): Promise<void>;
};

// One construct message = one node. Every step is idempotent, because SQS delivers at-least-once and the
// local worker redelivers on failure; the numbered rules are in docs/aws-retrofit.md.
//
// This use-case never catches: an error must reach the worker, or redelivery (and the dead-letter path
// behind it) is defeated.
export function createExpandNode({
  nodeState,
  dedup,
  treeRepo,
  queue,
  articleQueue,
  runState,
  fanIn,
  constructor,
  logger,
}: ExpandNodeDeps): ExpandNode {
  return {
    async execute(message) {
      const { runId, nodeId, parentId, depth, maxDepth, topic, ancestors } = message;

      const node = await nodeState.claim({ runId, nodeId, parentId, depth });
      // Rule 1: this node is already finished, so a duplicate delivery does nothing.
      if (node.status === "done" || node.status === "failed") return;

      // Before the LLM call, not after: a node whose expansion fails must still appear in the tree under
      // its known topic, or a run that stops early has nothing to show (docs/conflicts.md C54). A null
      // brief never overwrites one already stored, so this stays a Rule 6 upsert.
      await treeRepo.upsertNode(message, null);

      let result = node.result;
      if (result === undefined) {
        const position = layerPosition(depth, maxDepth);
        const output = await constructor.construct({
          topic,
          context: { depth, maxDepth, position, ancestors },
          seedKey: nodeId,
        });
        // The verifier already forces [] at a leaf; skipping the claim here also saves one dedup
        // round-trip per leaf, which is most of the tree at a realistic maxDepth.
        const deduped =
          position === "leaf" ? [] : await dedup.claimTopics(runId, nodeId, output.children);
        // The run's node budget, claimed BEFORE saveResult on purpose: expectedChildren is derived from
        // the stored child set, so trimming afterwards would leave the parent's fan-in waiting forever
        // for children that were never sent (docs/conflicts.md C60).
        const granted = deduped.length === 0 ? 0 : await runState.reserveNodes(runId, deduped.length);
        const children = granted === deduped.length ? deduped : deduped.slice(0, granted);
        if (children.length < deduped.length) {
          logger.warn("node budget reached: children dropped", {
            nodeId,
            topic,
            depth,
            requested: deduped.length,
            granted,
            note: "the tree stops here; the run still completes",
          });
        }
        // Rule 2 + 3: stored before any side effect, and the STORED value is what we go on to use, so a
        // concurrent delivery that got there first wins and both agree on the child set.
        const saved = await nodeState.saveResult(nodeId, { brief: output.brief, children });
        result = saved.result;
        if (result === undefined) throw new Error(`saveResult left node ${nodeId} without a result`);
      }

      // Rule 6: an upsert, so a redelivery rewrites the same row.
      await treeRepo.upsertNode(message, result.brief);

      if (result.children.length === 0) {
        // A leaf: nothing below it to wait for, so its scroll can be written at once.
        await articleQueue.send(toArticleMessage(message));
        await fanIn.completeConstruction(nodeId, "done");
        return;
      }

      const childMessages = result.children.map((childTopic) =>
        childConstructMessage(message, result.brief, childTopic),
      );
      // Rule 4 before the send: a child that completes fast must find its own state already there.
      await nodeState.createPending(childMessages);
      // The frontier is known now, so show it: these rows render as `pending` (or `blocked` on a halted
      // run) even if their messages are never handled. They are also what the writer reads to signpost
      // this node's subtopics, which is why they are upserted BEFORE the article message goes out.
      await treeRepo.upsertPending(childMessages);
      // The hand-off to the second pass, one node at a time: this node's brief is durable and its child
      // topics are on their rows, so everything the writer needs exists. The article is then written in
      // parallel with the children's expansion, so by the time the leaf layer is being built the layer
      // above it already has its scroll (C91). A redelivery re-sends it; claimArticle absorbs that.
      await articleQueue.send(toArticleMessage(message));
      await queue.sendBatch(childMessages);
    },
  };
}

import { ROOT_DEPTH } from "../../config/constants";
import type { ParsedRequest } from "../../domain/schemas/node.schema";
import { NodeMessage } from "../../domain/schemas/queue-message.schema";
import { nextAncestors } from "../../domain/traversal/ancestor-window";
import { childPath, pathLabel } from "../../domain/traversal/node-id";
import { childNodeId, rootNodeId } from "./node-ids";

// One construct message for the root. The root needs no special-casing downstream: its own expansion
// enqueues its children exactly as any other node's does.
export function rootConstructMessage(runId: string, parsed: ParsedRequest): NodeMessage {
  const nodeId = rootNodeId(runId);
  return {
    pass: "construct",
    runId,
    nodeId,
    parentId: null,
    topic: parsed.topic,
    depth: ROOT_DEPTH,
    maxDepth: parsed.maxDepth,
    path: pathLabel(nodeId),
    ancestors: [],
  };
}

// The article pass reuses the construct message wholesale: same nodeId, same path, same ancestors - only
// the queue and the `pass` differ. That matters for idempotency rule 4, because the article message for a
// node MUST carry the same deterministic id construction gave it, or the two passes would disagree about
// which node they are talking about.
//
// Since C91 this is the ONLY way an article message is made: the node that has just been expanded sends
// its own, so the ancestor window it is holding is exactly the parent context the writer needs and no
// message has to be rebuilt from stored state.
export function toArticleMessage(message: NodeMessage): NodeMessage {
  return { ...message, pass: "article" };
}

// The child's id is derived from (runId, parentId, normalized topic), so a redelivered parent produces the
// same children (idempotency rule 4). nextAncestors keeps the window at ANCESTOR_WINDOW, which is what
// makes "ancestors <= 2 in every message" true by construction rather than by assertion.
export function childConstructMessage(
  parent: NodeMessage,
  parentBrief: string,
  childTopic: string,
): NodeMessage {
  const nodeId = childNodeId(parent.runId, parent.nodeId, childTopic);
  return {
    pass: "construct",
    runId: parent.runId,
    nodeId,
    parentId: parent.nodeId,
    topic: childTopic,
    depth: parent.depth + 1,
    maxDepth: parent.maxDepth,
    path: childPath(parent.path, nodeId),
    ancestors: nextAncestors(parent.ancestors, {
      depth: parent.depth,
      topic: parent.topic,
      brief: parentBrief,
    }),
  };
}

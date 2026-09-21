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

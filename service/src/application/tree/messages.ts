import { ANCESTOR_WINDOW, ROOT_DEPTH } from "../../config/constants";
import type { AncestorRef, ChildDraft } from "../../domain/schemas/node.schema";
import { NodeMessage } from "../../domain/schemas/queue-message.schema";
import { nextAncestors } from "../../domain/traversal/ancestor-window";
import type { StoredNode } from "../ports/tree-repository.port";
import { childPath, pathLabel } from "../../domain/traversal/node-id";
import { childNodeId, rootNodeId } from "./node-ids";

export type RootRequest = {
  // Provisional: cut from the request until the root call names the canonical topic (C100).
  topic: string;
  maxDepth: number;
  // The learner's raw text. Travels in this one message only; the root call is the only prompt it enters.
  request: string;
};

// One construct message for the root. Downstream, the root differs only in carrying `request`: its own
// expansion names the topic and enqueues its children exactly as any other node's does.
export function rootConstructMessage(runId: string, root: RootRequest): NodeMessage {
  const nodeId = rootNodeId(runId);
  return {
    pass: "construct",
    runId,
    nodeId,
    parentId: null,
    topic: root.topic,
    depth: ROOT_DEPTH,
    maxDepth: root.maxDepth,
    path: pathLabel(nodeId),
    ancestors: [],
    request: root.request,
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
// The raw request is dropped: the writer reads the canonical topic, never the learner's text (C100).
export function toArticleMessage(message: NodeMessage): NodeMessage {
  const { request: _request, ...rest } = message;
  return { ...rest, pass: "article" };
}

// The child's id is derived from (runId, parentId, normalized topic), so a redelivered parent produces the
// same children (idempotency rule 4). nextAncestors keeps the window at ANCESTOR_WINDOW, which is what
// makes "ancestors <= 2 in every message" true by construction rather than by assertion.
// The child carries the brief its parent wrote for it (C99). `parent.topic` must already be canonical: the
// root's raw request never reaches a child (C100), so `request` is not copied.
export function childConstructMessage(parent: NodeMessage, parentBrief: string, child: ChildDraft): NodeMessage {
  const nodeId = childNodeId(parent.runId, parent.nodeId, child.topic);
  return {
    pass: "construct",
    runId: parent.runId,
    nodeId,
    parentId: parent.nodeId,
    topic: child.topic,
    depth: parent.depth + 1,
    maxDepth: parent.maxDepth,
    path: childPath(parent.path, nodeId),
    ancestors: nextAncestors(parent.ancestors, {
      depth: parent.depth,
      topic: parent.topic,
      brief: parentBrief,
    }),
    brief: child.brief,
  };
}

// A node's message rebuilt from stored rows: the shape construction sent, for a caller that holds no message -
// the boost use-case, which must name the message it wants promoted (C128). `lineage` is the node's stored
// ancestors, nearest LAST, as the window keeps them. The root comes back WITHOUT its raw `request`: that text is
// never re-materialised from storage, so a rebuilt root construct message must not be sent anywhere.
export function rebuildMessage(
  pass: NodeMessage["pass"],
  node: Pick<StoredNode, "nodeId" | "runId" | "parentId" | "topic" | "depth" | "path" | "brief">,
  lineage: readonly AncestorRef[],
  maxDepth: number,
): NodeMessage {
  return NodeMessage.parse({
    pass,
    runId: node.runId,
    nodeId: node.nodeId,
    parentId: node.parentId,
    topic: node.topic,
    depth: node.depth,
    maxDepth,
    path: node.path,
    ancestors: lineage.slice(-ANCESTOR_WINDOW),
    // The root's brief comes from its own call and never travels on a message; every other node carries the
    // brief its parent wrote, which is what its row holds.
    ...(node.parentId === null ? {} : { brief: node.brief }),
  });
}

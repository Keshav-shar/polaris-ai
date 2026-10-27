import { z } from "zod";
import { ANCESTOR_WINDOW, MAX_DEPTH_CEILING } from "../../config/constants";
import { TreeRequestBody } from "./api.schema";
import { AncestorRef, Brief } from "./node.schema";

// One message = one unit of work on either queue (construct or article), including their DLQs.
export const NodeMessage = z.object({
  pass: z.enum(["construct", "article"]),
  runId: z.uuid(),
  nodeId: z.uuid(), // deterministic UUIDv5 of (runId, parentId, normalized topic)
  parentId: z.uuid().nullable(), // null for the root
  topic: z.string().trim().min(1),
  depth: z.number().int().min(0),
  maxDepth: z.number().int().min(1).max(MAX_DEPTH_CEILING),
  path: z.string().min(1), // ltree path built from node ids
  ancestors: z.array(AncestorRef).max(ANCESTOR_WINDOW),
  // The node's own brief, written by its PARENT's expansion (docs/conflicts.md C99). Absent only on the
  // root, whose brief comes from its own call.
  brief: Brief.optional(),
  // Root only: the learner's raw request, which the root expansion reads to name the topic (C100). It is
  // the ONLY place raw user text travels; every other message carries the canonical topic instead.
  request: TreeRequestBody.shape.prompt.optional(),
  // A learner asked for this node's scroll (POST /api/nodes/:id/boost). Decides ORDER only - where the message
  // waits and where its LLM call waits - never what the handler does with it (C128).
  boost: z.literal(true).optional(),
});
export type NodeMessage = z.infer<typeof NodeMessage>;

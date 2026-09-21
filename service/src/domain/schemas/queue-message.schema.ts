import { z } from "zod";
import { ANCESTOR_WINDOW, MAX_DEPTH_CEILING } from "../../config/constants";
import { AncestorRef } from "./node.schema";

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
});
export type NodeMessage = z.infer<typeof NodeMessage>;

import { z } from "zod";
import { WriterOutput } from "./article.schema";
import { Brief } from "./node.schema";

// In-flight build state: the DynamoDB `PolarisNodes` item shape (in-memory record locally).
export const NodeStatus = z.enum(["pending", "in_progress", "expanded", "done", "failed"]);
export type NodeStatus = z.infer<typeof NodeStatus>;

export const ArticleStatus = z.enum(["pending", "in_progress", "done", "failed"]);
export type ArticleStatus = z.infer<typeof ArticleStatus>;

export const NodeState = z.object({
  nodeId: z.uuid(),
  runId: z.uuid(),
  parentId: z.uuid().nullable(),
  depth: z.number().int().min(0),
  status: NodeStatus,
  attempts: z.number().int().min(0),
  result: z.object({ brief: Brief, children: z.array(z.string()) }).optional(), // written once
  expectedChildren: z.number().int().min(0).optional(),
  completedChildren: z.number().int().min(0).default(0),
  completedChildIds: z.array(z.uuid()).default([]), // String Set in DynamoDB
  failedChildren: z.number().int().min(0).default(0),
  articleStatus: ArticleStatus.optional(),
  // Written once, like `result`, and reused on a redelivery so a retry never calls the LLM again
  // (idempotency rule 2, docs/aws-retrofit.md). It holds the WHOLE writer output, questions included -
  // storing only the article would make a retry regenerate the questions. Present in
  // docs/data-model.md's DynamoDB item all along; amendment A2 and C38 omitted it, which is the
  // doc-vs-doc gap C77 records.
  article: WriterOutput.optional(),
});
export type NodeState = z.infer<typeof NodeState>;

export const RunState = z.object({
  runId: z.uuid(),
  // Nodes the run has created, counting the root, and the children MAX_NODES_PER_RUN refused. A run with
  // nodesSkipped > 0 has a complete tree of the nodes it kept, not the tree its maxDepth describes.
  nodesCreated: z.number().int().min(0).default(1),
  nodesSkipped: z.number().int().min(0).default(0),
  nodesDone: z.number().int().min(0).default(0),
  nodesFailed: z.number().int().min(0).default(0),
  articlesDone: z.number().int().min(0).default(0),
  articlesFailed: z.number().int().min(0).default(0),
});
export type RunState = z.infer<typeof RunState>;

import { z } from "zod";
import { MAX_DEPTH_CEILING } from "../../config/constants";
import { TreeNode } from "./node.schema";
import { RunStatus } from "./run.schema";

export const HealthResponse = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
  llmConfigured: z.boolean(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const TreeRequestBody = z.object({
  prompt: z.string().trim().min(1).max(500),
  // Optional cap on the depth the parser infers from the prompt. Omitted = the inferred depth, unchanged.
  // It only ever LOWERS cost when the caller asks it to; the hard ceiling on a run stays MAX_NODES_PER_RUN,
  // which no request can raise (docs/conflicts.md C60, C62).
  maxDepth: z.number().int().min(1).max(MAX_DEPTH_CEILING).optional(),
});
export type TreeRequestBody = z.infer<typeof TreeRequestBody>;

export const StartTreeResponse = z.object({ runId: z.uuid() });
export type StartTreeResponse = z.infer<typeof StartTreeResponse>;

// Path params of GET /api/trees/:runId. A non-uuid is a bad request, not an unknown run: validating here
// keeps a malformed id from reaching the repository at all.
export const RunIdParams = z.object({ runId: z.uuid() });
export type RunIdParams = z.infer<typeof RunIdParams>;

// Re-exported so the UI contract keeps a single import site; defined in run.schema.ts with the Run record.
export { RunStatus };

export const TreeResponse = z.object({
  run: z.object({
    runId: z.uuid(),
    topic: z.string(),
    maxDepth: z.number().int().min(1).max(MAX_DEPTH_CEILING),
    status: RunStatus,
    haltReason: z.string().optional(),
  }),
  tree: TreeNode.nullable(), // null only when the run has no nodes at all
  stats: z.object({
    nodesDone: z.number().int().min(0),
    nodesFailed: z.number().int().min(0),
    // Children MAX_NODES_PER_RUN refused. Above 0 the tree is complete as built but shallower or
    // narrower than `maxDepth` implies - the UI must say so rather than present it as the full tree.
    nodesSkipped: z.number().int().min(0),
    articlesDone: z.number().int().min(0),
    articlesFailed: z.number().int().min(0),
  }),
});
export type TreeResponse = z.infer<typeof TreeResponse>;

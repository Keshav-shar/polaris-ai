import { z } from "zod";
import { MAX_DEPTH_CEILING, RUNS_LIST_LIMIT } from "../../config/constants";
import { Article } from "./article.schema";
import { TreeNode } from "./node.schema";
import { LessonFeedback } from "./feedback.schema";
import { NodeProgress, PublicQuiz, RunProgress } from "./progress.schema";
import { RunStats, RunStatus, RunVisibility } from "./run.schema";

export const HealthResponse = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
  llmConfigured: z.boolean(),
  // Whether building and "my library" need a signed-in user: true whenever Supabase is configured (C105, C137).
  authRequired: z.boolean(),
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
  // Optional tree height. Omitted = a depth stated in the prompt ("3 levels deep"), else DEFAULT_MAX_DEPTH
  // (C100). Bounded by MAX_DEPTH_CEILING here, and the hard ceiling on a run stays MAX_NODES_PER_RUN, which
  // no request can raise (docs/conflicts.md C60, C62).
  maxDepth: z.number().int().min(1).max(MAX_DEPTH_CEILING).optional(),
});
export type TreeRequestBody = z.infer<typeof TreeRequestBody>;

export const StartTreeResponse = z.object({
  runId: z.uuid(),
  // How many of the caller's oldest private, finished maps were deleted to stay within MAX_STORED_RUNS_PER_USER
  // (C105). Absent when none were: the "with notice" half of the stored-run cap.
  prunedRuns: z.number().int().min(1).optional(),
});
export type StartTreeResponse = z.infer<typeof StartTreeResponse>;

// Path params of GET /api/trees/:runId. A non-uuid is a bad request, not an unknown run: validating here
// keeps a malformed id from reaching the repository at all.
export const RunIdParams = z.object({ runId: z.uuid() });
export type RunIdParams = z.infer<typeof RunIdParams>;

// Re-exported so the UI contract keeps a single import site; defined in run.schema.ts with the Run record.
export { RunStats, RunStatus, RunVisibility };

// PATCH /api/trees/:runId - the owner shares or un-shares a map (C105).
export const VisibilityBody = z.object({ visibility: RunVisibility });
export type VisibilityBody = z.infer<typeof VisibilityBody>;

export const VisibilityResponse = z.object({ runId: z.uuid(), visibility: RunVisibility });
export type VisibilityResponse = z.infer<typeof VisibilityResponse>;

// GET /api/runs. The Codex lists every run's scrolls, so it needs the runs before it can fetch trees.
// Capped by RUNS_LIST_LIMIT: an unbounded list would grow with the process.
export const RunsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(RUNS_LIST_LIMIT).default(RUNS_LIST_LIMIT),
  // mine = the caller's own maps (sign-in required when auth is on); public = maps their owners listed for
  // everyone. With auth off every run is ownerless and `mine` lists them all, as before Phase 12.
  scope: z.enum(["mine", "public"]).default("mine"),
});
export type RunsQuery = z.infer<typeof RunsQuery>;

export const RunSummary = z.object({
  runId: z.uuid(),
  topic: z.string(),
  maxDepth: z.number().int().min(1).max(MAX_DEPTH_CEILING),
  status: RunStatus,
  haltReason: z.string().optional(),
  // Absent for an ownerless run (auth off).
  visibility: RunVisibility.optional(),
});
export type RunSummary = z.infer<typeof RunSummary>;

export const RunsResponse = z.object({ runs: z.array(RunSummary) });
export type RunsResponse = z.infer<typeof RunsResponse>;

// GET /api/nodes/:nodeId. One call for the reader: the node, its place in the tree, its article and its
// questions. Phase 9's reader had to list runs and walk each tree to find a node, because this did not
// exist yet.
export const NodeIdParams = z.object({ nodeId: z.uuid() });
export type NodeIdParams = z.infer<typeof NodeIdParams>;

export const NodeResponse = z.object({
  node: z.object({
    id: z.uuid(),
    runId: z.uuid(),
    topic: z.string(),
    depth: z.number().int().min(0),
    brief: z.string(),
    parent: z.object({ id: z.uuid(), topic: z.string() }).nullable(),
    children: z.array(z.object({ id: z.uuid(), topic: z.string() })),
  }),
  // null until the article pass reaches this node; the UI says "not yet written" rather than spinning.
  article: Article.nullable(),
  // Present only when the article will NEVER arrive, so the reader can distinguish a scroll still being
  // written from one that failed - both used to render as "not yet written".
  articleFailureReason: z.string().optional(),
  // null when the node has no quiz, which is legitimate: questions need evidence to cite (C80). Questions and
  // options only: the answer key and explanations arrive with the response to an attempt (C106).
  quiz: PublicQuiz.nullable(),
  // The signed-in caller's own state on this lesson; absent for an anonymous reader or a lesson not yet touched.
  progress: NodeProgress.optional(),
  feedback: LessonFeedback.optional(),
});
export type NodeResponse = z.infer<typeof NodeResponse>;

// POST /api/nodes/:nodeId/boost (C128). Never an LLM call: it moves this node's waiting work to the front.
//   promoted              - its article message was waiting and is now first in line
//   awaiting-construction - not expanded yet: recorded, its construct message promoted, and its article will
//                           be sent boosted
//   writing               - already being written (or between attempts), nothing to move
//   written / failed      - nothing left to do; a failed scroll's retry is a separate action
export const BoostStatus = z.enum(["promoted", "awaiting-construction", "writing", "written", "failed"]);
export type BoostStatus = z.infer<typeof BoostStatus>;

export const BoostResponse = z.object({ nodeId: z.uuid(), status: BoostStatus });
export type BoostResponse = z.infer<typeof BoostResponse>;

export const TreeResponse = z.object({
  run: z.object({
    runId: z.uuid(),
    topic: z.string(),
    maxDepth: z.number().int().min(1).max(MAX_DEPTH_CEILING),
    status: RunStatus,
    haltReason: z.string().optional(),
    // Both absent for an ownerless run (auth off). `isOwner` is what lets the UI offer the sharing control.
    visibility: RunVisibility.optional(),
    isOwner: z.boolean().optional(),
  }),
  tree: TreeNode.nullable(), // null only when the run has no nodes at all
  stats: RunStats,
  // The signed-in reader's read/quiz state per node they have touched (C106); absent for an anonymous reader.
  progress: RunProgress.optional(),
});
export type TreeResponse = z.infer<typeof TreeResponse>;

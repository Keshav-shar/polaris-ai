// Relative imports only: ui/ type-checks this file, and there `@/` points at ui/src (docs/conflicts.md C41).
import { z } from "zod";
import { MAX_DEPTH_CEILING } from "../../config/constants";

// constructing -> constructed (whole tree built) -> done (every article written). failed is terminal.
// halted = the build stopped on a condition that clears by itself (the LLM daily quota) rather than by
// retrying. It is terminal for this process: leaving such a run `constructing` would tell the UI to poll
// for a tree that never arrives, the same defect C52 fixed for a failed root (docs/conflicts.md C55).
export const RunStatus = z.enum(["constructing", "constructed", "done", "failed", "halted"]);
export type RunStatus = z.infer<typeof RunStatus>;

// Who may READ a run (C105). private = its owner only (the default); unlisted = anyone with the link; public =
// also listed for everyone. Building always needs a signed-in owner.
export const RunVisibility = z.enum(["private", "unlisted", "public"]);
export type RunVisibility = z.infer<typeof RunVisibility>;

// The run-level counters the UI shows. Live in the expiring run state while a run builds, and copied onto the
// durable record at each terminal transition so a finished run still has them (C107).
export const RunStats = z.object({
  nodesDone: z.number().int().min(0),
  nodesFailed: z.number().int().min(0),
  // Children MAX_NODES_PER_RUN refused. Above 0 the tree is complete as built but shallower or
  // narrower than `maxDepth` implies - the UI must say so rather than present it as the full tree.
  nodesSkipped: z.number().int().min(0),
  articlesDone: z.number().int().min(0),
  articlesFailed: z.number().int().min(0),
});
export type RunStats = z.infer<typeof RunStats>;

// The durable run record. Kept in a permanent store, never in the expiring node-state store
// (service/README.md, known plan defect 2).
export const Run = z.object({
  runId: z.uuid(),
  topic: z.string().trim().min(1),
  maxDepth: z.number().int().min(1).max(MAX_DEPTH_CEILING),
  status: RunStatus,
  // One readable line for why a run is `halted` or `failed`, shown instead of a stack trace.
  haltReason: z.string().optional(),
  // Absent only on a run built with auth off (no Supabase configured, C137): such a run has no owner and is
  // readable by anyone, which is how every run behaved before Phase 12.
  ownerId: z.uuid().optional(),
  visibility: RunVisibility.optional(),
  // The learner's raw prompt, kept for the owner. Never part of any response about someone else's run.
  request: z.string().optional(),
  stats: RunStats.optional(),
});
export type Run = z.infer<typeof Run>;

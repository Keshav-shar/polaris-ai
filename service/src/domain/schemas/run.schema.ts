// Relative imports only: ui/ type-checks this file, and there `@/` points at ui/src (docs/conflicts.md C41).
import { z } from "zod";
import { MAX_DEPTH_CEILING } from "../../config/constants";

// constructing -> constructed (whole tree built) -> done (every article written). failed is terminal.
// halted = the build stopped on a condition that clears by itself (the LLM daily quota) rather than by
// retrying. It is terminal for this process: leaving such a run `constructing` would tell the UI to poll
// for a tree that never arrives, the same defect C52 fixed for a failed root (docs/conflicts.md C55).
export const RunStatus = z.enum(["constructing", "constructed", "done", "failed", "halted"]);
export type RunStatus = z.infer<typeof RunStatus>;

// The durable run record. Kept in a permanent store, never in the expiring node-state store
// (service/README.md, known plan defect 2).
export const Run = z.object({
  runId: z.uuid(),
  topic: z.string().trim().min(1),
  maxDepth: z.number().int().min(1).max(MAX_DEPTH_CEILING),
  status: RunStatus,
  // One readable line for why a run is `halted` or `failed`, shown instead of a stack trace.
  haltReason: z.string().optional(),
});
export type Run = z.infer<typeof Run>;

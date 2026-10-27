import type { RunState } from "../../domain/schemas/node-state.schema";
import type { TerminalStatus } from "./node-state.port";

// Per-run counters, read by GET /api/trees/:runId. Separate from the durable run record: these expire
// with the in-flight state, the run itself does not.
export type RunStatePort = {
  // Atomic increment, creating the item on first call (DynamoDB ADD semantics). Returns the new totals.
  countNode(runId: string, status: TerminalStatus): Promise<RunState>;

  // Claims up to `requested` node slots against MAX_NODES_PER_RUN and returns how many were granted
  // (0..min(requested, limit)). `limit` is the balanced branch cap (C101): children over it are refused
  // too, so they count as skipped exactly like the ones the budget refuses - the UI's "narrower than
  // maxDepth implies" notice must not depend on WHICH guard trimmed the tree. One conditional write, so two
  // parents expanding at once cannot both spend the last slot. Phase 13 is the same conditional update in
  // DynamoDB. Idempotency: expand-node calls this ONCE per node, before the child set is stored, so a
  // redelivery reuses the stored (already trimmed) set and never reserves twice.
  reserveNodes(runId: string, requested: number, limit?: number): Promise<number>;
  get(runId: string): Promise<RunState | undefined>;

  // Atomic increment of articlesDone / articlesFailed, same DynamoDB ADD semantics as countNode, and it
  // returns the new totals so the caller can decide whether the run is finished. The fields have existed
  // on RunState since Phase 2 (amendment A3 / C38) with no way to move them - that was gap 4.
  countArticle(runId: string, outcome: TerminalStatus): Promise<RunState>;
};

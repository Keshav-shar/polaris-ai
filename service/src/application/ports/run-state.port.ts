import type { RunState } from "../../domain/schemas/node-state.schema";
import type { TerminalStatus } from "./node-state.port";

// Per-run counters, read by GET /api/trees/:runId. Separate from the durable run record: these expire
// with the in-flight state, the run itself does not.
export type RunStatePort = {
  // Atomic increment, creating the item on first call (DynamoDB ADD semantics). Returns the new totals.
  countNode(runId: string, status: TerminalStatus): Promise<RunState>;

  // Claims up to `requested` node slots against MAX_NODES_PER_RUN and returns how many were granted
  // (0..requested). One conditional write, so two parents expanding at once cannot both spend the last
  // slot. The refused remainder is counted as skipped. Phase 13 is the same conditional update in
  // DynamoDB. Idempotency: expand-node calls this ONCE per node, before the child set is stored, so a
  // redelivery reuses the stored (already trimmed) set and never reserves twice.
  reserveNodes(runId: string, requested: number): Promise<number>;
  get(runId: string): Promise<RunState | undefined>;
};

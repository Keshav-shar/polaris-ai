import type { NodeState } from "../../domain/schemas/node-state.schema";
import type { NodeMessage } from "../../domain/schemas/queue-message.schema";

export type ClaimRequest = Pick<NodeMessage, "runId" | "nodeId" | "parentId" | "depth">;

export type NodeResult = { brief: string; children: readonly string[] };

export type TerminalStatus = "done" | "failed";

// In-flight construction state. Every method is a conditional write, because SQS delivers at-least-once:
// the rules these implement are numbered 1-7 in docs/aws-retrofit.md.
export type NodeStatePort = {
  // Rule 1 + 2. Creates the item if missing, increments attempts and moves it to in_progress - UNLESS it
  // is already done or failed, in which case it is returned untouched so a duplicate delivery is a no-op.
  // An already-expanded node comes back with its stored `result`, so a retry never regenerates.
  claim(request: ClaimRequest): Promise<NodeState>;

  // Rule 3. ONE conditional write of result + expectedChildren + status "expanded", before any child
  // message exists, so a fast child cannot complete before its parent can count it.
  // Rule 2: when a result is already stored it is returned as-is rather than overwritten, so two
  // deliveries of the same node can never disagree about the child set.
  saveResult(nodeId: string, result: NodeResult): Promise<NodeState>;

  // Rule 4. Creates each child as pending only if absent (ids are deterministic), so re-sending children
  // on a retry is harmless.
  createPending(messages: readonly NodeMessage[]): Promise<void>;

  // Conditional terminal transition. Resolves undefined when the node was already done/failed or is
  // missing - that `undefined` is what makes a node complete its parent exactly once.
  finish(nodeId: string, status: TerminalStatus): Promise<NodeState | undefined>;

  // Rule 5. Set-add on completedChildIds plus the counters, conditional on the child not already being
  // present. Resolves undefined for a duplicate completion or a missing parent.
  recordChildCompletion(
    parentId: string,
    childId: string,
    childStatus: TerminalStatus,
  ): Promise<NodeState | undefined>;
};

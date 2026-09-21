import type { ClaimRequest, NodeResult, NodeStatePort, TerminalStatus } from "../../application/ports/node-state.port";
import type { NodeState } from "../../domain/schemas/node-state.schema";
import type { NodeMessage } from "../../domain/schemas/queue-message.schema";

// Atomicity contract: every method below does its read-modify-write with NO `await` between the read and
// the write, so the single-threaded event loop makes it atomic exactly as a DynamoDB conditional
// expression is. Inserting an await inside one of these blocks would silently break idempotency rule 3 or
// 5. Getters return copies, as the DynamoDB twin necessarily does.

const TERMINAL: readonly string[] = ["done", "failed"];

function copy(state: NodeState): NodeState {
  return { ...state, completedChildIds: [...state.completedChildIds] };
}

export function createMemoryNodeStateStore(): NodeStatePort {
  const items = new Map<string, NodeState>();

  const blank = (request: ClaimRequest, status: NodeState["status"]): NodeState => ({
    nodeId: request.nodeId,
    runId: request.runId,
    parentId: request.parentId,
    depth: request.depth,
    status,
    attempts: 0,
    completedChildren: 0,
    completedChildIds: [],
    failedChildren: 0,
  });

  return {
    async claim(request) {
      const existing = items.get(request.nodeId);
      if (existing === undefined) {
        const created = { ...blank(request, "in_progress"), attempts: 1 };
        items.set(request.nodeId, created);
        return copy(created);
      }
      // Rule 1: a finished node is returned untouched, so the caller returns without doing anything.
      if (TERMINAL.includes(existing.status)) return copy(existing);
      existing.attempts += 1;
      existing.status = "in_progress";
      return copy(existing);
    },

    async saveResult(nodeId, result: NodeResult) {
      const state = items.get(nodeId);
      if (state === undefined) throw new Error(`saveResult: node ${nodeId} does not exist`);
      // Rule 2: an existing result is never overwritten - a retry reuses it, so two deliveries of the same
      // node can never disagree about the child set.
      if (state.result !== undefined || TERMINAL.includes(state.status)) return copy(state);
      // Rule 3: result + expectedChildren + status in one write, before any child message exists.
      state.result = { brief: result.brief, children: [...result.children] };
      state.expectedChildren = result.children.length;
      state.status = "expanded";
      return copy(state);
    },

    async createPending(messages: readonly NodeMessage[]) {
      for (const message of messages) {
        // Rule 4: create-if-absent on a deterministic id, so re-sending children on retry is harmless.
        if (items.has(message.nodeId)) continue;
        items.set(
          message.nodeId,
          blank({ runId: message.runId, nodeId: message.nodeId, parentId: message.parentId, depth: message.depth }, "pending"),
        );
      }
    },

    async finish(nodeId, status: TerminalStatus) {
      const state = items.get(nodeId);
      if (state === undefined || TERMINAL.includes(state.status)) return undefined;
      state.status = status;
      return copy(state);
    },

    async recordChildCompletion(parentId, childId, childStatus) {
      const parent = items.get(parentId);
      if (parent === undefined) return undefined;
      // Rule 5: set membership is the condition, so a duplicate completion is ignored rather than counted.
      if (parent.completedChildIds.includes(childId)) return undefined;
      parent.completedChildIds.push(childId);
      parent.completedChildren += 1;
      if (childStatus === "failed") parent.failedChildren += 1;
      return copy(parent);
    },
  };
}

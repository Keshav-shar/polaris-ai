import type { TreeNode } from "../../domain/schemas/node.schema";
import type { NodeMessage } from "../../domain/schemas/queue-message.schema";
import type { TerminalStatus } from "./node-state.port";

// The permanent tree store: in memory now, Postgres from Phase 12.
export type TreeRepositoryPort = {
  // Rule 6. Upsert keyed on message.nodeId, so replaying a message changes nothing.
  // brief null = "not expanded yet": the row appears at its known topic without overwriting a real brief.
  upsertNode(message: NodeMessage, brief: string | null): Promise<void>;
  // Rule 4's companion: the children of an expanded node become visible as `pending` in ONE write, so a
  // run that stalls still shows the frontier it had already discovered. Never downgrades a known node.
  upsertPending(messages: readonly NodeMessage[]): Promise<void>;
  setStatus(nodeId: string, status: TerminalStatus): Promise<void>;
  // Nested from parentId links. EVERY node is included, whatever its status - a partially built tree is
  // the point (docs/conflicts.md C54). null only when the run has no rows at all.
  getTree(runId: string): Promise<TreeNode | null>;
};

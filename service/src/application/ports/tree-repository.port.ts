import type { TreeNode } from "../../domain/schemas/node.schema";
import type { NodeMessage } from "../../domain/schemas/queue-message.schema";
import type { TerminalStatus } from "./node-state.port";

export type StoredNodeStatus = "pending" | "expanded" | TerminalStatus;

export type StoredNode = {
  nodeId: string;
  runId: string;
  parentId: string | null;
  topic: string;
  depth: number;
  brief: string;
  status: StoredNodeStatus;
  articleStatus?: TerminalStatus;
  // Why the article failed, as one readable line. Present only with `articleStatus: "failed"`: the
  // dead-letter path used to record THAT a node lost its scroll but never WHY, so the cause lived only
  // in the worker's stdout and no one without terminal access could tell a 429 from a bad draft.
  articleFailureReason?: string;
  // `brief` is what lets an article SIGNPOST its subtopics without teaching them (C86); `status` is
  // what decides which children get an article at all.
  children: readonly { nodeId: string; topic: string; brief: string; status: StoredNodeStatus }[];
};

// The permanent tree store: in memory now, Postgres from Phase 12.
export type TreeRepositoryPort = {
  // Rule 6. Upsert keyed on message.nodeId, so replaying a message changes nothing.
  // brief null = "not expanded yet": the row appears at its known topic without overwriting a real brief.
  upsertNode(message: NodeMessage, brief: string | null): Promise<void>;
  // Rule 4's companion: the children of an expanded node become visible as `pending` in ONE write, so a
  // run that stalls still shows the frontier it had already discovered. Never downgrades a known node.
  upsertPending(messages: readonly NodeMessage[]): Promise<void>;
  setStatus(nodeId: string, status: TerminalStatus): Promise<void>;
  // The article axis, recorded alongside construction's status so the read model needs no second
  // store - and so it does not depend on NodeState, which expires.
  setArticleStatus(nodeId: string, status: TerminalStatus, reason?: string): Promise<void>;
  // Nested from parentId links. EVERY node is included, whatever its status - a partially built tree is
  // the point (docs/conflicts.md C54). null only when the run has no rows at all.
  getTree(runId: string): Promise<TreeNode | null>;

  // One node with its children's ids, topics, BRIEFS and STATUSES. The article pass needs the statuses, because
  // "failed construction nodes get no article" (docs/aws-retrofit.md) and NodeState.completedChildIds
  // mixes done with failed children. Read from the permanent store on purpose: NodeState expires after
  // NODE_STATE_TTL_DAYS, and sourcing article input from an expiring store is the known plan defect
  // service/README.md warns about. GET /api/nodes/:nodeId reads through this too.
  getNode(nodeId: string): Promise<StoredNode | undefined>;
};

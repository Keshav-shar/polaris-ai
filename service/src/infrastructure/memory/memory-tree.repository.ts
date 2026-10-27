import type { TerminalStatus } from "../../application/ports/node-state.port";
import type { StoredNode, TreeRepositoryPort } from "../../application/ports/tree-repository.port";
import type { TreeNode } from "../../domain/schemas/node.schema";
import type { NodeMessage } from "../../domain/schemas/queue-message.schema";

type RowStatus = "pending" | "expanded" | TerminalStatus;

type NodeRow = {
  nodeId: string;
  runId: string;
  parentId: string | null;
  topic: string;
  depth: number;
  path: string;
  brief: string;
  status: RowStatus;
  articleStatus?: TerminalStatus;
  articleFailureReason?: string;
};

// A row only ever moves forward: pending (topic known) -> expanded (children decided) -> done|failed. A
// redelivery re-upserts at a lower rank and must not drag a node backwards.
const RANK: Record<RowStatus, number> = { pending: 0, expanded: 1, done: 2, failed: 2 };

export function createMemoryTreeRepository(): TreeRepositoryPort {
  const rows = new Map<string, NodeRow>();
  // Indexes, kept in insertion order, so a read touches one run's rows instead of every row in the process:
  // a long-lived API polled every 2 s would otherwise scan all runs ever built on every poll. Phase 12's
  // `nodes` table gets the same two indexes (`run_id`, `parent_id`).
  const byRun = new Map<string, string[]>();
  const byParent = new Map<string, string[]>();

  const index = (map: Map<string, string[]>, key: string, nodeId: string): void => {
    const ids = map.get(key);
    if (ids === undefined) map.set(key, [nodeId]);
    else ids.push(nodeId);
  };

  const write = (message: NodeMessage, brief: string | null, status: RowStatus): void => {
    const existing = rows.get(message.nodeId);
    if (existing === undefined) {
      index(byRun, message.runId, message.nodeId);
      if (message.parentId !== null) index(byParent, message.parentId, message.nodeId);
    }
    rows.set(message.nodeId, {
      nodeId: message.nodeId,
      runId: message.runId,
      parentId: message.parentId,
      topic: message.topic,
      depth: message.depth,
      path: message.path,
      // A null brief means "nothing new": never blank a brief we already have.
      brief: brief ?? existing?.brief ?? "",
      status: existing !== undefined && RANK[existing.status] >= RANK[status] ? existing.status : status,
      // The article axis belongs to the second pass: a construction upsert (a redelivered parent re-sending
      // its children's rows) must not erase a scroll that is already written or failed.
      ...(existing?.articleStatus === undefined ? {} : { articleStatus: existing.articleStatus }),
      ...(existing?.articleFailureReason === undefined ? {} : { articleFailureReason: existing.articleFailureReason }),
    });
  };

  return {
    // Rule 6: an upsert keyed on nodeId, so replaying a message changes nothing.
    async upsertNode(message: NodeMessage, brief: string | null) {
      write(message, brief, brief === null ? "pending" : "expanded");
    },

    // Each child arrives with the brief its parent wrote (C99), so the row shows it from the start.
    async upsertPending(messages: readonly NodeMessage[]) {
      for (const message of messages) write(message, message.brief ?? null, "pending");
    },

    async setStatus(nodeId: string, status: TerminalStatus) {
      const row = rows.get(nodeId);
      if (row !== undefined) row.status = status;
    },

    async setArticleStatus(nodeId: string, status: TerminalStatus, reason?: string) {
      const row = rows.get(nodeId);
      if (row === undefined) return;
      row.articleStatus = status;
      // Only a failure carries a reason, and a success clears any earlier one: a node that was rewritten
      // successfully must not keep explaining a failure it no longer has.
      if (status === "failed") row.articleFailureReason = reason;
      else delete row.articleFailureReason;
    },

    async getNode(nodeId: string): Promise<StoredNode | undefined> {
      const row = rows.get(nodeId);
      if (row === undefined) return undefined;
      // Children carry their STATUS, which is the whole point: the article pass must skip failed
      // construction nodes, and NodeState.completedChildIds cannot tell done from failed.
      const children = (byParent.get(nodeId) ?? [])
        .flatMap((childId) => {
          const child = rows.get(childId);
          return child === undefined ? [] : [child];
        })
        // The brief was always on the row and merely projected away; the writer needs it to signpost.
        .map((child) => ({
          nodeId: child.nodeId,
          topic: child.topic,
          brief: child.brief,
          status: child.status,
        }));
      return { ...row, children };
    },

    async getTree(runId: string) {
      const byParent = new Map<string | null, NodeRow[]>();
      let root: NodeRow | undefined;
      for (const nodeId of byRun.get(runId) ?? []) {
        const row = rows.get(nodeId);
        if (row === undefined) continue;
        if (row.parentId === null) root = row;
        const siblings = byParent.get(row.parentId);
        if (siblings === undefined) byParent.set(row.parentId, [row]);
        else siblings.push(row);
      }
      if (root === undefined) return null;

      const build = (row: NodeRow): TreeNode => ({
        id: row.nodeId,
        topic: row.topic,
        depth: row.depth,
        brief: row.brief,
        status: row.status,
        ...(row.articleStatus === undefined ? {} : { articleStatus: row.articleStatus }),
        ...(row.articleFailureReason === undefined
          ? {}
          : { articleFailureReason: row.articleFailureReason }),
        children: (byParent.get(row.nodeId) ?? []).map(build),
      });
      return build(root);
    },
  };
}

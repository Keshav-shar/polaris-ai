import { z } from "zod";
import type { TerminalStatus } from "../../application/ports/node-state.port";
import type { StoredNode, TreeRepositoryPort } from "../../application/ports/tree-repository.port";
import type { TreeNode } from "../../domain/schemas/node.schema";
import type { NodeMessage } from "../../domain/schemas/queue-message.schema";
import { check } from "./postgres-error";
import type { Db } from "./supabase.client";

const StoredStatus = z.enum(["pending", "expanded", "done", "failed"]);
const ArticleStatus = z.enum(["done", "failed"]);

const NodeRow = z.object({
  id: z.uuid(),
  run_id: z.uuid(),
  parent_id: z.uuid().nullable(),
  path: z.string(),
  topic: z.string(),
  depth: z.number().int().min(0),
  brief: z.string(),
  status: StoredStatus,
  article_status: ArticleStatus.nullable(),
  article_failure_reason: z.string().nullable(),
});
type NodeRow = z.infer<typeof NodeRow>;

const ChildRow = NodeRow.pick({ id: true, topic: true, brief: true, status: true });

const NODE_COLUMNS = "id, run_id, parent_id, path, topic, depth, brief, status, article_status, article_failure_reason";

// What upsert_nodes takes: one entry per message. `brief: null` = "nothing new", never a blank (C54, C99).
function rowFor(message: NodeMessage, brief: string | null, status: "pending" | "expanded") {
  return {
    id: message.nodeId,
    run_id: message.runId,
    parent_id: message.parentId,
    path: message.path,
    topic: message.topic,
    depth: message.depth,
    brief,
    status,
  };
}

// The permanent tree store in Postgres. Every multi-row or conditional write goes through upsert_nodes, so a row
// only ever moves forward and a whole child set appears in one statement (C54, C107).
export function createPostgresTreeRepository(db: Db): TreeRepositoryPort {
  const nodes = () => db.from("nodes");

  const upsert = async (operation: string, rows: ReturnType<typeof rowFor>[]): Promise<void> => {
    if (rows.length === 0) return;
    // ON CONFLICT cannot touch one row twice in a statement, so a repeated id is collapsed first (last wins,
    // which is what writing them one by one would have left).
    const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
    check(operation, await db.rpc("upsert_nodes", { p_nodes: unique }));
  };

  return {
    async upsertNode(message, brief) {
      await upsert("nodes.upsertNode", [rowFor(message, brief, brief === null ? "pending" : "expanded")]);
    },

    async upsertPending(messages) {
      await upsert(
        "nodes.upsertPending",
        messages.map((message) => rowFor(message, message.brief ?? null, "pending")),
      );
    },

    async setStatus(nodeId, status: TerminalStatus) {
      check("nodes.setStatus", await nodes().update({ status }).eq("id", nodeId));
    },

    async setArticleStatus(nodeId, status: TerminalStatus, reason?: string) {
      // Only a failure carries a reason, and a success clears any earlier one.
      check(
        "nodes.setArticleStatus",
        await nodes()
          .update({ article_status: status, article_failure_reason: status === "failed" ? (reason ?? null) : null })
          .eq("id", nodeId),
      );
    },

    async getNode(nodeId): Promise<StoredNode | undefined> {
      // Two indexed reads in parallel: the row by primary key, its children by (parent_id, seq).
      const [own, kids] = await Promise.all([
        nodes().select(NODE_COLUMNS).eq("id", nodeId).maybeSingle(),
        nodes().select("id, topic, brief, status").eq("parent_id", nodeId).order("seq", { ascending: true }),
      ]);
      check("nodes.getNode", own);
      check("nodes.getNode.children", kids);
      if (own.data === null) return undefined;
      const row = NodeRow.parse(own.data);
      const children = (kids.data ?? []).map((raw) => {
        const child = ChildRow.parse(raw);
        return { nodeId: child.id, topic: child.topic, brief: child.brief, status: child.status };
      });
      return {
        nodeId: row.id,
        runId: row.run_id,
        parentId: row.parent_id,
        topic: row.topic,
        depth: row.depth,
        path: row.path,
        brief: row.brief,
        status: row.status,
        ...(row.article_status === null ? {} : { articleStatus: row.article_status }),
        ...(row.article_failure_reason === null ? {} : { articleFailureReason: row.article_failure_reason }),
        children,
      };
    },

    async getTree(runId) {
      // One indexed read of the run's rows in insertion order; nested here exactly as the memory store does.
      // A run holds at most MAX_NODES_PER_RUN rows, under PostgREST's default 1,000-row page.
      const result = await nodes().select(NODE_COLUMNS).eq("run_id", runId).order("seq", { ascending: true });
      check("nodes.getTree", result);
      const rows = (result.data ?? []).map((raw) => NodeRow.parse(raw));
      const byParent = new Map<string | null, NodeRow[]>();
      let root: NodeRow | undefined;
      for (const row of rows) {
        if (row.parent_id === null) root = row;
        const siblings = byParent.get(row.parent_id);
        if (siblings === undefined) byParent.set(row.parent_id, [row]);
        else siblings.push(row);
      }
      if (root === undefined) return null;

      const build = (row: NodeRow): TreeNode => ({
        id: row.id,
        topic: row.topic,
        depth: row.depth,
        brief: row.brief,
        status: row.status,
        ...(row.article_status === null ? {} : { articleStatus: row.article_status }),
        ...(row.article_failure_reason === null ? {} : { articleFailureReason: row.article_failure_reason }),
        children: (byParent.get(row.id) ?? []).map(build),
      });
      return build(root);
    },
  };
}

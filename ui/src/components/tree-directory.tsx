"use client";

import Link from "next/link";
import type { TreeNode, TreeNodeStatus } from "../lib/contract";

// The left-hand topic list. This is where the WHOLE tree stays navigable, which is what lets the map draw
// only a neighbourhood: a 500-node run is a scrollable list here and an unreadable hairball there.
//
// Every row does BOTH things the map does - re-centre it, and open the lesson - because a node that looks
// reachable from the map and unreachable from the sidebar is just a bug with extra steps (C84).
const STATUS_DOT: Record<TreeNodeStatus, string> = {
  done: "bg-gold",
  expanded: "bg-gold-glow animate-pulse",
  pending: "bg-line",
  failed: "bg-danger",
  blocked: "bg-warn/60",
};

function Row({
  node,
  focusId,
  onFocus,
}: {
  node: TreeNode;
  focusId: string;
  onFocus: (id: string) => void;
}) {
  const active = node.id === focusId;
  const written = node.articleStatus === "done";

  const label = (
    <div
      className={`flex items-center gap-1 rounded-lg pr-1 text-xs transition-colors ${
        active ? "border border-line bg-gold-soft font-semibold text-ink" : "text-muted hover:bg-parchment-dark"
      }`}
    >
      <button
        type="button"
        onClick={() => onFocus(node.id)}
        aria-current={active ? "true" : undefined}
        title={`Show "${node.topic}" on the map`}
        className="flex min-w-0 flex-1 items-center gap-2 p-2 text-left"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[node.status]}`} aria-hidden="true" />
        <span className="truncate">{node.topic}</span>
      </button>

      {/* The same affordance the map gives, so the two surfaces can never disagree about whether a node
          can be opened. The icon says whether its lesson is written yet; the link works either way, and
          the reader states plainly when a lesson has not arrived. */}
      <Link
        href={`/topic/${node.id}`}
        title={written ? `Read the lesson on "${node.topic}"` : `Open "${node.topic}" (lesson still being written)`}
        className={`shrink-0 rounded px-1.5 py-1 text-[11px] transition-colors ${
          written ? "text-gold-ink hover:bg-gold-soft" : "text-faint hover:text-ink"
        }`}
      >
        {written ? "★" : "☆"}
      </Link>
    </div>
  );

  if (node.children.length === 0) return <li>{label}</li>;
  return (
    <li>
      <details open={node.depth < 1}>
        <summary className="list-none">{label}</summary>
        <ul className="ml-3 space-y-0.5 border-l border-rule pl-2">
          {node.children.map((child) => (
            <Row key={child.id} node={child} focusId={focusId} onFocus={onFocus} />
          ))}
        </ul>
      </details>
    </li>
  );
}

export function TreeDirectory({
  tree,
  focusId,
  onFocus,
  nodeCount,
}: {
  tree: TreeNode | null;
  focusId: string;
  onFocus: (id: string) => void;
  nodeCount: number;
}) {
  return (
    <aside className="parchment-card sticky top-6 rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between border-b border-rule pb-3">
        <h2 className="font-serif text-base font-bold text-ink">All topics</h2>
        <span className="rounded border border-line bg-gold-soft px-2 py-0.5 text-[10px] font-medium text-gold-ink">
          {nodeCount} topics
        </span>
      </div>
      {tree === null ? (
        <p className="text-xs text-subtle">No topics yet.</p>
      ) : (
        <>
          <ul className="max-h-[26rem] space-y-0.5 overflow-y-auto pr-1">
            <Row node={tree} focusId={focusId} onFocus={onFocus} />
          </ul>
          <p className="mt-3 border-t border-rule pt-2 text-[10px] text-faint">
            Click a name to see it on the map · ★ opens the lesson
          </p>
        </>
      )}
    </aside>
  );
}

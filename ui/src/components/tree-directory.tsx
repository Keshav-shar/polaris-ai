"use client";

import Link from "next/link";
import type { TreeNode, TreeNodeStatus } from "../lib/contract";

// The reference's left-hand "Constellation Roadmap". This is where the WHOLE tree stays navigable, which
// is what lets the constellation draw only a neighbourhood: a 500-node run is a scrollable list here and
// an unreadable hairball there.
//
// Every row does BOTH things the constellation does - re-centre the map, and open the scroll - because a
// node that looks reachable from the map and unreachable from the sidebar is just a bug with extra steps.
const STATUS_DOT: Record<TreeNodeStatus, string> = {
  done: "bg-astral-gold",
  expanded: "bg-astral-amber animate-pulse",
  pending: "bg-astral-600",
  failed: "bg-red-500",
  blocked: "bg-amber-700",
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
        active
          ? "border border-astral-gold/40 bg-astral-gold/20 font-semibold text-astral-gold"
          : "text-slate-300 hover:bg-astral-800/50"
      }`}
    >
      <button
        type="button"
        onClick={() => onFocus(node.id)}
        aria-current={active ? "true" : undefined}
        title={`Centre the constellation on "${node.topic}"`}
        className="flex min-w-0 flex-1 items-center gap-2 p-2 text-left"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[node.status]}`} aria-hidden="true" />
        <span className="truncate">{node.topic}</span>
      </button>

      {/* The same affordance the constellation gives, so the two surfaces can never disagree about
          whether a node can be opened. The star says whether its scroll is written yet; the link works
          either way, and the reader states plainly when an article has not arrived. */}
      <Link
        href={`/topic/${node.id}`}
        title={written ? `Read "${node.topic}"` : `Open "${node.topic}" - scroll not written yet`}
        className={`shrink-0 rounded px-1.5 py-1 text-[11px] transition-colors ${
          written ? "text-astral-gold hover:bg-astral-gold/20" : "text-slate-600 hover:text-slate-300"
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
        <ul className="ml-3 space-y-0.5 border-l border-astral-gold/15 pl-2">
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
    <aside className="mystic-panel arch-border sticky top-24 rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between border-b border-astral-gold/20 pb-3">
        <h2 className="font-serif text-sm font-bold text-astral-gold">Constellation Roadmap</h2>
        <span className="rounded border border-astral-gold/30 bg-astral-gold/10 px-2 py-0.5 font-mono text-[10px] text-astral-gold">
          {nodeCount} runes
        </span>
      </div>
      {tree === null ? (
        <p className="text-xs text-slate-500">No stars charted yet.</p>
      ) : (
        <>
          <ul className="max-h-[26rem] space-y-0.5 overflow-y-auto pr-1">
            <Row node={tree} focusId={focusId} onFocus={onFocus} />
          </ul>
          <p className="mt-3 border-t border-astral-gold/20 pt-2 font-mono text-[10px] text-slate-600">
            Name centres the map · ★ opens the scroll
          </p>
        </>
      )}
    </aside>
  );
}

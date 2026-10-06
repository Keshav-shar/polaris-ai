"use client";

import Link from "next/link";
import type { Placement, TreeIndex } from "../lib/constellation-layout";
import { buildConstellation } from "../lib/constellation-layout";
import type { TreeNodeStatus } from "../lib/contract";

const STATUS_RING: Record<TreeNodeStatus, string> = {
  done: "bg-gradient-to-tr from-astral-gold to-amber-400 text-astral-950 shadow-gold-glow",
  expanded: "bg-astral-900 border-2 border-astral-amber text-astral-amber shadow-torch-glow animate-pulse",
  pending: "bg-astral-900 border border-astral-600 text-slate-400",
  blocked: "bg-astral-900 border border-amber-700/60 text-amber-600",
  failed: "bg-astral-900 border border-red-800 text-red-400",
};

const STATUS_LABEL: Record<TreeNodeStatus, string> = {
  done: "done",
  expanded: "expanding",
  pending: "queued",
  failed: "failed",
  blocked: "not reached",
};

const ROLE_SIZE = {
  focus: "h-16 w-16 text-base",
  parent: "h-11 w-11 text-xs",
  sibling: "h-10 w-10 text-xs",
  child: "h-12 w-12 text-sm",
} as const;

function initials(topic: string): string {
  const words = topic.trim().split(/\s+/).slice(0, 2);
  return words.map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

function Star({ placement, onFocus }: { placement: Placement; onFocus: (id: string) => void }) {
  const { node, role, x, y } = placement;
  const isFocus = role === "focus";
  return (
    <div
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <button
        type="button"
        onClick={() => onFocus(node.id)}
        aria-current={isFocus ? "true" : undefined}
        title={node.brief === "" ? node.topic : `${node.topic} — ${node.brief}`}
        className={`flex items-center justify-center rounded-full font-serif font-bold transition-transform duration-300 hover:scale-110 ${ROLE_SIZE[role]} ${STATUS_RING[node.status]}`}
      >
        {initials(node.topic)}
      </button>
      <span
        className={`max-w-[9rem] text-center font-serif text-[11px] leading-tight ${
          isFocus ? "text-astral-gold" : "text-slate-400"
        }`}
      >
        {node.topic}
        {/* Same marker the sidebar uses, so the two surfaces never disagree about what is readable. */}
        {node.articleStatus === "done" ? (
          <span className="ml-1 text-astral-gold" title="scroll written">
            ★
          </span>
        ) : null}
      </span>
      {isFocus ? (
        <span className="font-mono text-[9px] uppercase tracking-widest text-slate-500">
          depth {node.depth} · {STATUS_LABEL[node.status]}
        </span>
      ) : null}
    </div>
  );
}

export function ConstellationView({
  index,
  focusId,
  onFocus,
}: {
  index: TreeIndex;
  focusId: string;
  onFocus: (id: string) => void;
}) {
  const constellation = buildConstellation(index, focusId);
  if (constellation === null) {
    return <p className="p-8 text-center text-sm text-slate-400">That star is no longer in this chart.</p>;
  }

  const { focus, parentId, placements } = constellation;
  const childCount = focus.children.length;

  return (
    <section aria-label="Constellation" className="space-y-4">
      <div className="relative h-[28rem] overflow-hidden rounded-2xl border border-astral-gold/20 bg-astral-950/80 p-6">
        {/* Decorative orbits, straight from the reference. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-20">
          <div className="absolute h-96 w-96 animate-orbit-slow rounded-full border border-astral-gold" />
          <div className="absolute h-64 w-64 animate-orbit-reverse rounded-full border border-astral-blue" />
        </div>

        {/* Edges are drawn behind the stars: parent above the focus, children below it. */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          {placements
            .filter((p) => p.role === "parent" || p.role === "child")
            .map((p) => (
              <line
                key={`edge-${p.node.id}`}
                x1="50%"
                y1="50%"
                x2={`${p.x}%`}
                y2={`${p.y}%`}
                stroke="rgba(212,175,55,0.25)"
                strokeWidth="1"
              />
            ))}
        </svg>

        <div className="relative h-full w-full">
          {placements.map((placement) => (
            <Star key={placement.node.id} placement={placement} onFocus={onFocus} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <p className="text-slate-400">
          {parentId === null ? "At the root of the constellation." : "Select any star to re-centre."}{" "}
          {childCount === 0 ? "This is a leaf." : `${childCount} branch${childCount === 1 ? "" : "es"} below.`}
        </p>
        <Link
          href={`/topic/${focus.id}`}
          className="rounded-lg border border-astral-gold/40 bg-astral-gold/10 px-3 py-1.5 font-serif text-astral-gold transition-colors hover:bg-astral-gold/20"
        >
          {focus.articleStatus === "done" ? "Read this scroll →" : "Open this scroll →"}
        </Link>
      </div>
    </section>
  );
}

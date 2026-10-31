"use client";

import Link from "next/link";
import type { Placement, TreeIndex } from "../lib/constellation-layout";
import { buildConstellation } from "../lib/constellation-layout";
import type { TreeNodeStatus } from "../lib/contract";

const STATUS_RING: Record<TreeNodeStatus, string> = {
  done: "bg-ink text-parchment shadow-md",
  expanded: "bg-card border-2 border-gold text-gold-ink animate-pulse",
  pending: "bg-card border border-line text-subtle",
  blocked: "bg-card border border-warn/40 text-warn",
  failed: "bg-card border border-danger/50 text-danger",
};

const STATUS_LABEL: Record<TreeNodeStatus, string> = {
  done: "ready",
  expanded: "in progress",
  pending: "waiting",
  failed: "couldn't build",
  blocked: "skipped",
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

function TopicDot({ placement, onFocus }: { placement: Placement; onFocus: (id: string) => void }) {
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
        title={node.brief === "" ? node.topic : `${node.topic}: ${node.brief}`}
        className={`flex items-center justify-center rounded-full font-serif font-bold transition-transform duration-300 hover:scale-110 ${ROLE_SIZE[role]} ${STATUS_RING[node.status]}`}
      >
        {initials(node.topic)}
      </button>
      <span
        className={`max-w-[9rem] text-center font-serif text-xs leading-tight ${
          isFocus ? "font-bold text-ink" : "text-muted"
        }`}
      >
        {node.topic}
        {/* Same marker the sidebar uses, so the two surfaces never disagree about what is readable. */}
        {node.articleStatus === "done" ? (
          <span className="ml-1 text-gold-ink" title="lesson ready">
            ★
          </span>
        ) : null}
      </span>
      {isFocus ? (
        <span className="text-[9px] uppercase tracking-widest text-faint">
          level {node.depth + 1} · {STATUS_LABEL[node.status]}
        </span>
      ) : null}
    </div>
  );
}

// The map: the focused topic with its parent above, its siblings beside and its children below. Only this
// neighbourhood is drawn; the sidebar keeps the whole tree reachable.
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
    return <p className="p-8 text-center text-sm text-subtle">That topic is no longer on this map.</p>;
  }

  const { focus, parentId, placements } = constellation;
  const childCount = focus.children.length;

  return (
    <section aria-label="Learning map" className="space-y-4">
      <div className="relative h-[28rem] overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-gold-soft to-parchment-deep p-6 shadow-inner">
        {/* Two faint, static rings around the focused topic. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-40">
          <div className="absolute h-96 w-96 rounded-full border border-dashed border-line" />
          <div className="absolute h-64 w-64 rounded-full border border-line" />
        </div>

        {/* Edges are drawn behind the topics: parent above the focus, children below it. */}
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
                stroke="var(--color-gold)"
                strokeOpacity="0.45"
                strokeDasharray="3 3"
                strokeWidth="1.5"
              />
            ))}
        </svg>

        <div className="relative h-full w-full">
          {placements.map((placement) => (
            <TopicDot key={placement.node.id} placement={placement} onFocus={onFocus} />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <p className="text-subtle">
          {parentId === null ? "This is the main topic." : "Click any topic to move the map to it."}{" "}
          {childCount === 0
            ? "It has no smaller topics."
            : `It splits into ${childCount} smaller topic${childCount === 1 ? "" : "s"}.`}
        </p>
        <Link
          href={`/topic/${focus.id}`}
          className="rounded-xl bg-ink px-4 py-2 text-xs font-semibold uppercase tracking-wider text-parchment transition-colors hover:bg-gold-ink"
        >
          {focus.articleStatus === "done" ? "Read this lesson →" : "Open this topic →"}
        </Link>
      </div>
    </section>
  );
}

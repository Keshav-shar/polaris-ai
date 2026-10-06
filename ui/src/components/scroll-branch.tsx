import Link from "next/link";
import type { TreeNode } from "../lib/contract";

// One scroll inside a codex, and its descendants. The nesting IS the knowledge tree, so the indent is the
// information: a reader sees at a glance that "Thylakoid membranes" lives under "Chloroplast structure".
export function ScrollBranch({ node, highlight }: { node: TreeNode; highlight: string }) {
  const written = node.articleStatus === "done";
  const failed = node.articleStatus === "failed";
  const isMatch =
    highlight !== "" &&
    (node.topic.toLowerCase().includes(highlight) || node.brief.toLowerCase().includes(highlight));

  return (
    <li>
      <Link
        href={`/topic/${node.id}`}
        className={`flex items-baseline gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-astral-800/60 ${
          isMatch ? "bg-astral-gold/10" : ""
        }`}
      >
        <span
          aria-hidden="true"
          className={`shrink-0 text-xs ${written ? "text-astral-gold" : failed ? "text-red-400" : "text-slate-600"}`}
          // A filled star is a written scroll; an outline is one still to come. The article pass is
          // top-down, so this fills in as the run progresses.
        >
          {written ? "★" : failed ? "✕" : "☆"}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-serif text-sm text-astral-starlight">{node.topic}</span>
          {written && node.brief !== "" ? (
            <span className="block truncate text-[11px] text-slate-500">{node.brief}</span>
          ) : null}
          {failed ? <span className="block text-[11px] text-red-400">scroll failed</span> : null}
        </span>
      </Link>

      {node.children.length === 0 ? null : (
        <ul className="ml-4 space-y-0.5 border-l border-astral-gold/15 pl-2">
          {node.children.map((child) => (
            <ScrollBranch key={child.id} node={child} highlight={highlight} />
          ))}
        </ul>
      )}
    </li>
  );
}

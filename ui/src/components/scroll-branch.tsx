import Link from "next/link";
import type { TreeNode } from "../lib/contract";

// One lesson inside a library card, and its descendants. The nesting IS the knowledge tree, so the indent
// is the information: a reader sees at a glance that "Thylakoid membranes" lives under "Chloroplast
// structure".
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
        className={`flex items-baseline gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-parchment-dark ${
          isMatch ? "bg-gold-soft" : ""
        }`}
      >
        {/* A filled star is a written lesson; an outline is one still to come. Lessons are written
            top-down, so this fills in as the run progresses. */}
        <span
          aria-hidden="true"
          className={`shrink-0 text-xs ${written ? "text-gold-ink" : failed ? "text-danger" : "text-faint"}`}
        >
          {written ? "★" : failed ? "✕" : "☆"}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-serif text-base text-ink">{node.topic}</span>
          {written && node.brief !== "" ? (
            <span className="block truncate text-[11px] text-subtle">{node.brief}</span>
          ) : null}
          {failed ? <span className="block text-[11px] text-danger">This lesson couldn&apos;t be written</span> : null}
        </span>
      </Link>

      {node.children.length === 0 ? null : (
        <ul className="ml-4 space-y-0.5 border-l border-rule pl-2">
          {node.children.map((child) => (
            <ScrollBranch key={child.id} node={child} highlight={highlight} />
          ))}
        </ul>
      )}
    </li>
  );
}

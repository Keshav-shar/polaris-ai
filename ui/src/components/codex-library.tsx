"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getRuns, getTree } from "../lib/api-client";
import { flattenTree } from "../lib/constellation-layout";
import type { RunStatus, RunSummary, TreeNode } from "../lib/contract";
import { friendlyError } from "../lib/friendly-error";
import { EmptyState } from "./empty-state";
import { ScrollBranch } from "./scroll-branch";

type Codex = { run: RunSummary; root: TreeNode; scrolls: TreeNode[] };

type State =
  | { kind: "loading" }
  | { kind: "ready"; codices: Codex[] }
  | { kind: "error"; message: string };

const FIELD =
  "w-full rounded-xl border border-line bg-white px-4 py-2.5 text-xs text-ink-soft placeholder-faint shadow-inner focus:outline-none focus:ring-1 focus:ring-gold";

const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  constructing: "building",
  constructed: "writing lessons",
  done: "ready",
  halted: "paused",
  failed: "incomplete",
};

function matches(node: TreeNode, needle: string): boolean {
  return node.topic.toLowerCase().includes(needle) || node.brief.toLowerCase().includes(needle);
}

// The library lists one entry per MAP, not one per lesson: a 34-topic run is one card with 34 lessons
// inside it, opened in place. It is read-only and never polls - unlike a map being built, a library does
// not change under the reader. One runs call, then one tree call per run, bounded server-side by
// RUNS_LIST_LIMIT.
export function CodexLibrary() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [openRuns, setOpenRuns] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const controller = new AbortController();

    const load = async (): Promise<void> => {
      try {
        const { runs } = await getRuns(controller.signal);
        const trees = await Promise.all(
          runs.map(async (run) => {
            try {
              return { run, tree: await getTree(run.runId, controller.signal) };
            } catch {
              // One unreadable run must not blank the whole library.
              return undefined;
            }
          }),
        );
        const codices = trees.flatMap((entry) =>
          entry === undefined || entry.tree.tree === null
            ? []
            : [{ run: entry.run, root: entry.tree.tree, scrolls: flattenTree(entry.tree.tree) }],
        );
        if (!controller.signal.aborted) {
          setState({ kind: "ready", codices });
          // The newest map opens by default, so the page is never a wall of closed rows.
          setOpenRuns(new Set(codices.slice(0, 1).map((c) => c.run.runId)));
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: friendlyError(error, "We couldn't load your library. Please try again.") });
      }
    };

    void load();
    return () => controller.abort();
  }, []);

  const codices = state.kind === "ready" ? state.codices : [];
  const needle = query.trim().toLowerCase();

  // A search hit inside a collapsed card would be invisible, so searching filters the list AND forces
  // every remaining card open (C83).
  const visible = useMemo(() => {
    if (needle === "") return codices;
    return codices.filter((codex) => codex.scrolls.some((node) => matches(node, needle)));
  }, [codices, needle]);

  const toggle = (runId: string): void => {
    setOpenRuns((open) => {
      const next = new Set(open);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  if (state.kind === "loading") {
    return (
      <p role="status" className="py-16 text-center font-serif text-lg text-gold-ink">
        Loading your library…
      </p>
    );
  }

  if (state.kind === "error") {
    return (
      <EmptyState title="Your library didn't load">
        <p>{state.message}</p>
      </EmptyState>
    );
  }

  if (codices.length === 0) {
    return (
      <EmptyState
        title="Your library is empty"
        action={
          <Link
            href="/"
            className="inline-flex rounded-xl bg-ink px-6 py-3 text-xs font-semibold uppercase tracking-widest text-parchment transition-colors hover:bg-gold-ink"
          >
            Start learning
          </Link>
        }
      >
        <p>Every learning map you build is saved here, so you can come back to any lesson.</p>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-faint">
          Showing {visible.length} of {codices.length} map{codices.length === 1 ? "" : "s"}
        </p>
        <div className="w-full md:w-72">
          <label htmlFor="codex-search" className="sr-only">
            Search lessons
          </label>
          <input
            id="codex-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your lessons…"
            className={FIELD}
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No lessons match that search">
          <p>Try a broader word, or clear the search to see everything.</p>
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {visible.map((codex) => {
            const written = codex.scrolls.filter((n) => n.articleStatus === "done").length;
            // Forced open while searching, or a match inside a closed card could not be seen.
            const open = needle !== "" || openRuns.has(codex.run.runId);
            return (
              <li key={codex.run.runId} className="parchment-card rounded-2xl p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => toggle(codex.run.runId)}
                    aria-expanded={open}
                    className="flex flex-1 items-start gap-3 text-left"
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 text-gold transition-transform ${open ? "rotate-90" : ""}`}
                    >
                      ▸
                    </span>
                    <span>
                      <span className="block font-serif text-xl font-bold text-ink">{codex.root.topic}</span>
                      {codex.root.brief === "" ? null : (
                        <span className="mt-1 block text-xs leading-relaxed text-subtle">{codex.root.brief}</span>
                      )}
                    </span>
                  </button>

                  <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
                    <span className="rounded-full border border-line bg-gold-soft px-2.5 py-0.5 font-medium text-gold-ink">
                      {codex.scrolls.length} lessons
                    </span>
                    <span className="text-[11px] text-faint">
                      {written} written · {RUN_STATUS_LABEL[codex.run.status]}
                    </span>
                  </div>
                </div>

                {open ? (
                  <div className="mt-4 border-t border-rule pt-4">
                    <ul className="space-y-0.5">
                      <ScrollBranch node={codex.root} highlight={needle} />
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

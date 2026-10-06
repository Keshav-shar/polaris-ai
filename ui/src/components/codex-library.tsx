"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getRuns, getTree } from "../lib/api-client";
import { flattenTree } from "../lib/constellation-layout";
import type { RunSummary, TreeNode } from "../lib/contract";
import { EmptyState } from "./empty-state";
import { ScrollBranch } from "./scroll-branch";

type Codex = { run: RunSummary; root: TreeNode; scrolls: TreeNode[] };

type State =
  | { kind: "loading" }
  | { kind: "ready"; codices: Codex[] }
  | { kind: "error"; message: string };

const FIELD =
  "w-full rounded-xl border border-astral-gold/30 bg-astral-900 px-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:border-astral-gold focus:outline-none";

function matches(node: TreeNode, needle: string): boolean {
  return node.topic.toLowerCase().includes(needle) || node.brief.toLowerCase().includes(needle);
}

// The Codex lists one entry per TREE, not one per node: a 34-node run is one codex with 34 scrolls inside
// it, opened in place. It is read-only and never polls - unlike a constellation being charted, a library
// does not change under the reader. One runs call, then one tree call per run, bounded server-side by
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
          // The newest codex opens by default, so the page is never a wall of closed rows.
          setOpenRuns(new Set(codices.slice(0, 1).map((c) => c.run.runId)));
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "Could not reach the API.",
        });
      }
    };

    void load();
    return () => controller.abort();
  }, []);

  const codices = state.kind === "ready" ? state.codices : [];
  const needle = query.trim().toLowerCase();

  // A search hit inside a collapsed codex would be invisible, so searching filters the list AND forces
  // every remaining codex open.
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
      <p role="status" className="py-16 text-center font-serif text-astral-gold">
        Unrolling the codex…
      </p>
    );
  }

  if (state.kind === "error") {
    return (
      <EmptyState title="The codex is out of reach">
        <p>{state.message}</p>
      </EmptyState>
    );
  }

  if (codices.length === 0) {
    return (
      <EmptyState
        title="No scrolls charted yet"
        action={
          <Link
            href="/"
            className="rounded-xl border border-astral-gold/40 bg-astral-gold/10 px-5 py-2 font-serif text-sm text-astral-gold transition-colors hover:bg-astral-gold/20"
          >
            Invoke a constellation
          </Link>
        }
      >
        <p>
          Chart a constellation and it appears here as a codex of scrolls. Runs are held in memory until
          Phase 12, so this library empties whenever the service restarts.
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[11px] text-slate-500">
          {visible.length} of {codices.length} codex{codices.length === 1 ? "" : "es"}
        </p>
        <div className="w-full md:w-72">
          <label htmlFor="codex-search" className="sr-only">
            Search scrolls
          </label>
          <input
            id="codex-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search arcana scrolls…"
            className={FIELD}
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No scroll matches that search">
          <p>Try a broader term, or clear the search to see the whole codex.</p>
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {visible.map((codex) => {
            const written = codex.scrolls.filter((n) => n.articleStatus === "done").length;
            // Forced open while searching, or a match inside a closed codex could not be seen.
            const open = needle !== "" || openRuns.has(codex.run.runId);
            return (
              <li key={codex.run.runId} className="mystic-panel arch-border rounded-2xl p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => toggle(codex.run.runId)}
                    aria-expanded={open}
                    className="flex flex-1 items-start gap-3 text-left"
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1 font-mono text-astral-gold transition-transform ${open ? "rotate-90" : ""}`}
                    >
                      ▸
                    </span>
                    <span>
                      <span className="block font-serif text-lg font-bold text-astral-starlight">
                        {codex.root.topic}
                      </span>
                      {codex.root.brief === "" ? null : (
                        <span className="mt-1 block text-xs leading-relaxed text-slate-400">
                          {codex.root.brief}
                        </span>
                      )}
                    </span>
                  </button>

                  <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
                    <span className="rounded-full border border-astral-gold/30 bg-astral-gold/10 px-2.5 py-0.5 font-mono text-astral-gold">
                      {codex.scrolls.length} scrolls
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">
                      {written} written · {codex.run.status}
                    </span>
                  </div>
                </div>

                {open ? (
                  <div className="mt-4 border-t border-astral-gold/20 pt-4">
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

"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiClientError, getTree, isRunInProgress } from "../lib/api-client";
import { flattenTree, indexTree } from "../lib/constellation-layout";
import type { TreeResponse } from "../lib/contract";
import { ConstellationView } from "./constellation-view";
import { TreeDirectory } from "./tree-directory";

const POLL_INTERVAL_MS = 2_000;
// A single dropped request must not end a build that is still running server-side; a run of them means
// the API is genuinely gone, and polling in the dark forever is worse than saying so.
const MAX_CONSECUTIVE_FAILURES = 3;

type State =
  | { kind: "loading" }
  | { kind: "loaded"; tree: TreeResponse }
  | { kind: "error"; message: string; tree?: TreeResponse };

function statusLine(tree: TreeResponse): string {
  const { run, stats } = tree;
  switch (run.status) {
    case "constructing":
      return `Charting "${run.topic}" — ${stats.nodesDone} star(s) lit…`;
    case "constructed":
      return `The constellation of "${run.topic}" is complete — ${stats.nodesDone} stars.`;
    case "done":
      return `"${run.topic}" is complete, scrolls included.`;
    case "halted":
      return `Charting stopped early: ${run.haltReason ?? "the provider's daily quota ran out."}`;
    case "failed":
      return `Charting failed: ${run.haltReason ?? "see the service logs."}`;
  }
}

export function RunPanel({ runId }: { runId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    setState({ kind: "loading" });
    setFocusId(null);

    // Chained rather than setInterval: a slow response must not stack a second request on top of the
    // first, which would multiply polling load on a single-process API.
    const poll = async (): Promise<void> => {
      try {
        const tree = await getTree(runId, controller.signal);
        failures = 0;
        setState({ kind: "loaded", tree });
        if (isRunInProgress(tree.run.status)) timer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (error) {
        if (controller.signal.aborted) return;
        // An unknown run will never appear, and a 503 needs a config fix: retrying just burns requests.
        const fatal = error instanceof ApiClientError && (error.status === 404 || error.status === 503);
        failures += 1;
        if (fatal || failures >= MAX_CONSECUTIVE_FAILURES) {
          const message = error instanceof Error ? error.message : "Could not reach the API.";
          setState((prev) => ({
            kind: "error",
            message,
            ...(prev.kind === "loaded" ? { tree: prev.tree } : {}),
          }));
          return;
        }
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    void poll();
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [runId]);

  const tree = state.kind === "loading" ? undefined : state.tree;
  const root = tree?.tree ?? null;
  // Rebuilt only when the tree object changes, not on every focus click.
  const index = useMemo(() => indexTree(root), [root]);
  const nodeCount = useMemo(() => flattenTree(root).length, [root]);
  // Default to the root, and fall back to it if a poll ever drops the focused node.
  const activeFocus = focusId !== null && index.has(focusId) ? focusId : (root?.id ?? null);

  if (state.kind === "loading") {
    return (
      <p role="status" className="py-16 text-center font-serif text-astral-gold">
        Consulting the stars…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {state.kind === "error" ? (
        <p role="alert" className="rounded-xl border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">
          {state.message}
        </p>
      ) : null}

      {tree === undefined ? null : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-astral-gold/20 pb-3">
            <p role="status" aria-live="polite" data-run-status={tree.run.status} className="font-serif text-astral-starlight">
              {statusLine(tree)}
            </p>
            <span className="rounded-full border border-astral-gold/30 bg-astral-gold/10 px-3 py-1 font-mono text-[11px] text-astral-gold">
              {tree.stats.nodesDone} / {nodeCount} runes
            </span>
          </div>

          {tree.stats.nodesSkipped > 0 ? (
            // Complete as built, but narrower than maxDepth implies (docs/conflicts.md C60): presenting it
            // as the full tree would be a lie.
            <p role="note" className="text-xs text-amber-400">
              Constellation capped: {tree.stats.nodesSkipped} star(s) were left uncharted to stay inside the
              run&apos;s node limit.
            </p>
          ) : null}
          {tree.stats.nodesFailed > 0 ? (
            <p role="note" className="text-xs text-amber-400">
              {tree.stats.nodesFailed} star(s) failed to expand.
            </p>
          ) : null}

          {activeFocus === null ? (
            <p className="py-12 text-center text-sm text-slate-400">No stars charted yet.</p>
          ) : (
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
              <div className="lg:col-span-3">
                <TreeDirectory tree={root} focusId={activeFocus} onFocus={setFocusId} nodeCount={nodeCount} />
              </div>
              <div className="lg:col-span-9">
                <ConstellationView index={index} focusId={activeFocus} onFocus={setFocusId} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

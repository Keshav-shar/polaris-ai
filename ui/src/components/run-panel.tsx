"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiClientError, getTree, isRunInProgress } from "../lib/api-client";
import { friendlyError } from "../lib/friendly-error";
import { ShareControl } from "./share-control";
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
      return `Building your map of "${run.topic}": ${stats.nodesDone} topic${stats.nodesDone === 1 ? "" : "s"} so far…`;
    case "constructed":
      return `Your map of "${run.topic}" has ${stats.nodesDone} topics. Lessons are still being written…`;
    case "done":
      return `Your map of "${run.topic}" is ready, lessons included.`;
    case "halted":
      return "Polaris paused this map because it reached its lesson-writing limit. Everything built so far is below.";
    case "failed":
      return "Something went wrong while building this map. Everything built so far is below.";
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
          const message = friendlyError(error, "We couldn't load this map. Please try again.");
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
      <p role="status" className="py-16 text-center font-serif text-lg text-gold-ink">
        Loading your map…
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {state.kind === "error" ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          {state.message}
        </p>
      ) : null}

      {tree === undefined ? null : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-3">
            <p role="status" aria-live="polite" data-run-status={tree.run.status} className="font-serif text-lg font-semibold text-ink">
              {statusLine(tree)}
            </p>
            <span className="rounded-full border border-line bg-gold-soft px-3 py-1 text-[11px] font-medium text-gold-ink">
              {tree.stats.nodesDone} of {nodeCount} topics ready
            </span>
          </div>

          {tree.run.isOwner === true && tree.run.visibility !== undefined ? (
            <ShareControl runId={tree.run.runId} visibility={tree.run.visibility} />
          ) : null}

          {tree.stats.nodesSkipped > 0 ? (
            // Complete as built, but narrower than maxDepth implies (docs/conflicts.md C60): presenting it
            // as the full tree would be a lie.
            <p role="note" className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
              This map was trimmed to keep it a manageable size: {tree.stats.nodesSkipped} smaller topic
              {tree.stats.nodesSkipped === 1 ? " was" : "s were"} left out.
            </p>
          ) : null}
          {tree.stats.nodesFailed > 0 ? (
            <p role="note" className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
              {tree.stats.nodesFailed} topic{tree.stats.nodesFailed === 1 ? "" : "s"} couldn&apos;t be broken down
              further.
            </p>
          ) : null}

          {activeFocus === null ? (
            <p className="py-12 text-center text-sm text-subtle">No topics yet. They&apos;ll appear here in a moment.</p>
          ) : (
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
              <div className="lg:col-span-3">
                <TreeDirectory
                  tree={root}
                  focusId={activeFocus}
                  onFocus={setFocusId}
                  nodeCount={nodeCount}
                  progress={tree.progress}
                />
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

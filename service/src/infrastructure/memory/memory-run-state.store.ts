import type { TerminalStatus } from "../../application/ports/node-state.port";
import type { RunStatePort } from "../../application/ports/run-state.port";
import { MAX_NODES_PER_RUN } from "../../config/constants";
import type { RunState } from "../../domain/schemas/node-state.schema";

// Same atomicity contract as memory-node-state.store.ts: no await between read and write.
// The cap lives here rather than in the use-case so the read and the decrement are one step; in Phase 13
// that is a single DynamoDB conditional update.
export function createMemoryRunStateStore(maxNodesPerRun: number = MAX_NODES_PER_RUN): RunStatePort {
  const runs = new Map<string, RunState>();

  // nodesCreated starts at 1: every run has a root before any child is reserved.
  const itemFor = (runId: string): RunState =>
    runs.get(runId) ?? {
      runId,
      nodesCreated: 1,
      nodesSkipped: 0,
      nodesDone: 0,
      nodesFailed: 0,
      articlesDone: 0,
      articlesFailed: 0,
    };

  return {
    async reserveNodes(runId, requested, limit = requested) {
      if (!Number.isInteger(requested) || requested < 0) {
        throw new RangeError(`requested must be an integer >= 0, got ${requested}`);
      }
      const state = itemFor(runId);
      const wanted = Math.min(requested, Math.max(0, limit));
      const granted = Math.min(wanted, Math.max(0, maxNodesPerRun - state.nodesCreated));
      state.nodesCreated += granted;
      state.nodesSkipped += requested - granted;
      runs.set(runId, state);
      return granted;
    },

    async countNode(runId, status: TerminalStatus) {
      // DynamoDB ADD semantics: the item is created on first use.
      const state = itemFor(runId);
      if (status === "done") state.nodesDone += 1;
      else state.nodesFailed += 1;
      runs.set(runId, state);
      return { ...state };
    },

    async countArticle(runId, outcome: TerminalStatus) {
      // Same ADD semantics as countNode: the item is created on first use and the NEW totals come back,
      // so the caller can tell whether this was the article that finished the run.
      const state = itemFor(runId);
      if (outcome === "done") state.articlesDone += 1;
      else state.articlesFailed += 1;
      runs.set(runId, state);
      return { ...state };
    },

    async get(runId) {
      const state = runs.get(runId);
      return state === undefined ? undefined : { ...state };
    },
  };
}

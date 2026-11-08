import type { RunState } from "../schemas/node-state.schema";
import type { RunStats } from "../schemas/run.schema";

// The durable copy taken at a terminal transition (C107): the five counters the UI shows, never the run state's
// bookkeeping fields.
export function statsOf(state: RunState): RunStats {
  return {
    nodesDone: state.nodesDone,
    nodesFailed: state.nodesFailed,
    nodesSkipped: state.nodesSkipped,
    articlesDone: state.articlesDone,
    articlesFailed: state.articlesFailed,
  };
}

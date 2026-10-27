import { EXPAND } from "../../config/constants";
import { fullTreeSize } from "./branch-cap";

// What a tree costs before it is built. Deliberately a plain upper-ish estimate over `branching ^ depth`
// rather than a promise: the taper pulls the real figure below it, and repairs and retries push it up. It
// exists to let a run WARN that it cannot finish inside a free tier - it never lowers maxDepth, which stays
// the caller's decision (docs/conflicts.md C57).
export const ESTIMATE_BRANCHING = 5;

export type CallEstimate = {
  nodes: number;
  // One per node that has children: the final layer is written by its parent and never called (C99).
  expandCalls: number;
  // One per node: the article and its 3 questions are a single call (C74).
  writerCalls: number;
  total: number;
};

// `maxNodes` (MAX_NODES_PER_RUN) bounds the estimate the same way it bounds the run. The kickoff makes no
// LLM call at all since C100, so there is no "+1".
export function estimateCalls(
  maxDepth: number,
  options: { branching?: number; maxNodes?: number } = {},
): CallEstimate {
  const branching = options.branching ?? ESTIMATE_BRANCHING;
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new RangeError(`maxDepth must be an integer >= 1, got ${maxDepth}`);
  }
  if (!Number.isInteger(branching) || branching < 1 || branching > EXPAND.MAX_CHILDREN) {
    throw new RangeError(`branching must be an integer in [1, ${EXPAND.MAX_CHILDREN}], got ${branching}`);
  }
  const full = fullTreeSize(branching, maxDepth);
  const interiorFull = fullTreeSize(branching, maxDepth - 1);
  const nodes = options.maxNodes === undefined ? full : Math.min(full, options.maxNodes);
  // Under a node budget the kept tree is still mostly leaves; scale the interior share with it.
  const expandCalls = nodes === full ? interiorFull : Math.max(1, Math.ceil((nodes * interiorFull) / full));
  return { nodes, expandCalls, writerCalls: nodes, total: expandCalls + nodes };
}

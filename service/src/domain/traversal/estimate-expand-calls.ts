import { EXPAND } from "../../config/constants";

// What a tree costs before it is built. Deliberately a plain upper-ish estimate over `branching ^ depth`
// rather than a promise: the taper in the last two layers pulls the real figure below it, and repairs,
// consolidations and retries push it up. It exists to let a run WARN that it cannot finish inside a free
// tier - it never lowers maxDepth, which stays the caller's decision (docs/conflicts.md C57).
//
// Matches the figures already quoted in docs/free-tier-constraints.md: depth 2 -> 31, depth 3 -> 156.
export const ESTIMATE_BRANCHING = 5;

export function estimateExpandCalls(maxDepth: number, branching: number = ESTIMATE_BRANCHING): number {
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new RangeError(`maxDepth must be an integer >= 0, got ${maxDepth}`);
  }
  if (!Number.isInteger(branching) || branching < 1 || branching > EXPAND.MAX_CHILDREN) {
    throw new RangeError(`branching must be an integer in [1, ${EXPAND.MAX_CHILDREN}], got ${branching}`);
  }
  // Every node costs one expand call, leaves included: a leaf still asks the model for its brief.
  let total = 0;
  for (let depth = 0; depth <= maxDepth; depth++) total += branching ** depth;
  return total;
}

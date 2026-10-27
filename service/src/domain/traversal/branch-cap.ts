import { EXPAND } from "../../config/constants";

// Nodes in a full tree of branching `b` and height `maxDepth`: 1 + b + b^2 + ... + b^maxDepth.
export function fullTreeSize(branching: number, maxDepth: number): number {
  let total = 0;
  for (let depth = 0; depth <= maxDepth; depth++) total += branching ** depth;
  return total;
}

// The most children any one node may keep so that a FULL tree of this height still fits the run's node
// budget: the largest b with fullTreeSize(b, maxDepth) <= maxNodes, clamped to [1, EXPAND.MAX_CHILDREN].
// Applied to every node, it spends the budget evenly - every branch reaches the same depth - where the old
// first-come trim (C60) let the earliest branches exhaust it and left later ones a layer short
// (docs/conflicts.md C101). Pure: the use-case passes MAX_NODES_PER_RUN in.
export function branchCap(maxNodes: number, maxDepth: number): number {
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new RangeError(`maxDepth must be an integer >= 1, got ${maxDepth}`);
  }
  if (!Number.isInteger(maxNodes) || maxNodes < 1) {
    throw new RangeError(`maxNodes must be an integer >= 1, got ${maxNodes}`);
  }
  let cap = 1;
  while (cap < EXPAND.MAX_CHILDREN && fullTreeSize(cap + 1, maxDepth) <= maxNodes) cap += 1;
  return cap;
}

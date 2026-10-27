import { describe, expect, it } from "vitest";
import { EXPAND, MAX_NODES_PER_RUN } from "../../../../src/config/constants";
import { branchCap, fullTreeSize } from "../../../../src/domain/traversal/branch-cap";

describe("fullTreeSize", () => {
  it("is 1 + b + ... + b^maxDepth", () => {
    expect(fullTreeSize(5, 2)).toBe(31);
    expect(fullTreeSize(7, 3)).toBe(400);
    expect(fullTreeSize(1, 4)).toBe(5);
  });
});

describe("branchCap", () => {
  it.each([
    // [maxNodes, maxDepth, cap]
    [500, 3, 7], // 1+7+49+343 = 400 <= 500; 8 would be 585
    [500, 2, EXPAND.MAX_CHILDREN], // 21 fits, clamped to the absolute ceiling
    [31, 2, 5],
    [30, 2, 4],
    [7, 2, 2],
    [1, 3, 1], // never below 1: a tree always has somewhere to go
  ])("maxNodes %i at depth %i -> %i children per node", (maxNodes, maxDepth, cap) => {
    expect(branchCap(maxNodes, maxDepth)).toBe(cap);
  });

  it("keeps a full tree within the budget whenever the cap is above 1", () => {
    for (const maxDepth of [1, 2, 3, 4, 5, 6]) {
      const cap = branchCap(MAX_NODES_PER_RUN, maxDepth);
      if (cap > 1) expect(fullTreeSize(cap, maxDepth)).toBeLessThanOrEqual(MAX_NODES_PER_RUN);
    }
  });

  it("rejects nonsense", () => {
    expect(() => branchCap(500, 0)).toThrow(RangeError);
    expect(() => branchCap(0, 2)).toThrow(RangeError);
  });
});

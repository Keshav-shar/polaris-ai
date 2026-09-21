import { describe, expect, it } from "vitest";
import { EXPAND } from "../../../../src/config/constants";
import { ESTIMATE_BRANCHING, estimateExpandCalls } from "../../../../src/domain/traversal/estimate-expand-calls";

describe("estimateExpandCalls", () => {
  it("matches the figures the docs already quote", () => {
    // docs/free-tier-constraints.md: "at ~5 children, depth 2 is ~31 calls"; scripts/smoke-node.ts
    // defaults to depth 1 because that is ~6 calls, inside Gemini's 20/day.
    expect(estimateExpandCalls(1)).toBe(6);
    expect(estimateExpandCalls(2)).toBe(31);
    expect(estimateExpandCalls(3)).toBe(156);
  });

  it("counts the root alone at depth 0", () => {
    expect(estimateExpandCalls(0)).toBe(1);
  });

  it("shows why DEFAULT_MAX_DEPTH needs a budget warning", () => {
    // Q6 is still open: nothing bounds a run's node count, and depth 5 is far past any free tier.
    expect(estimateExpandCalls(5)).toBeGreaterThan(1000);
  });

  it("takes the branching factor as an argument", () => {
    expect(estimateExpandCalls(2, 2)).toBe(7);
    expect(estimateExpandCalls(2, 1)).toBe(3);
    expect(ESTIMATE_BRANCHING).toBe(5);
  });

  it("rejects inputs that would make the estimate meaningless", () => {
    expect(() => estimateExpandCalls(-1)).toThrow(RangeError);
    expect(() => estimateExpandCalls(1.5)).toThrow(RangeError);
    expect(() => estimateExpandCalls(2, 0)).toThrow(RangeError);
    // Never more children than the consolidator would allow through.
    expect(() => estimateExpandCalls(2, EXPAND.MAX_CHILDREN + 1)).toThrow(RangeError);
  });
});

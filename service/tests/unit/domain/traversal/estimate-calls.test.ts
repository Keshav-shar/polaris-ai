import { describe, expect, it } from "vitest";
import { EXPAND } from "../../../../src/config/constants";
import { ESTIMATE_BRANCHING, estimateCalls } from "../../../../src/domain/traversal/estimate-calls";

describe("estimateCalls", () => {
  // C99/C100: one expand call per node WITH children (the final layer is written by its parent), one writer
  // call per node, nothing at kickoff. At branching 5: depth 2 = 31 nodes, 6 interior.
  it("counts expand calls for interior nodes only and one writer call per node", () => {
    expect(estimateCalls(1)).toEqual({ nodes: 6, expandCalls: 1, writerCalls: 6, total: 7 });
    expect(estimateCalls(2)).toEqual({ nodes: 31, expandCalls: 6, writerCalls: 31, total: 37 });
    expect(estimateCalls(3)).toEqual({ nodes: 156, expandCalls: 31, writerCalls: 156, total: 187 });
  });

  it("is bounded by the run's node budget the way the run is", () => {
    const capped = estimateCalls(5, { maxNodes: 500 });
    expect(capped.nodes).toBe(500);
    expect(capped.writerCalls).toBe(500);
    expect(capped.expandCalls).toBeLessThan(capped.nodes / ESTIMATE_BRANCHING + 1);
    expect(capped.total).toBe(capped.expandCalls + capped.writerCalls);
  });

  it("takes a branching override", () => {
    expect(estimateCalls(2, { branching: 2 })).toEqual({ nodes: 7, expandCalls: 3, writerCalls: 7, total: 10 });
  });

  it("rejects a depth below 1 and a branching outside [1, EXPAND.MAX_CHILDREN]", () => {
    expect(() => estimateCalls(0)).toThrow(RangeError);
    expect(() => estimateCalls(1.5)).toThrow(RangeError);
    expect(() => estimateCalls(2, { branching: 0 })).toThrow(RangeError);
    expect(() => estimateCalls(2, { branching: EXPAND.MAX_CHILDREN + 1 })).toThrow(RangeError);
  });
});

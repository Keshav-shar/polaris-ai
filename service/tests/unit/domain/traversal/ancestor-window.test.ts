import { describe, expect, it } from "vitest";
import { ANCESTOR_WINDOW } from "../../../../src/config/constants";
import { nextAncestors } from "../../../../src/domain/traversal/ancestor-window";

const ref = (depth: number) => ({ depth, topic: `t${depth}`, brief: `b${depth}` });

describe("nextAncestors", () => {
  it("adds the parent to an empty window", () => {
    expect(nextAncestors([], ref(0))).toEqual([ref(0)]);
  });

  it("keeps only the nearest ANCESTOR_WINDOW levels", () => {
    const window = nextAncestors([ref(0), ref(1)], ref(2));
    expect(window).toHaveLength(ANCESTOR_WINDOW);
    expect(window).toEqual([ref(1), ref(2)]);
  });
});

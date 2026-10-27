import { describe, expect, it } from "vitest";
import { MAX_DEPTH_CEILING } from "../../../../src/config/constants";
import { parseDepthHint } from "../../../../src/domain/traversal/depth-hint";

describe("parseDepthHint", () => {
  it.each([
    ["teach me photosynthesis, 3 levels deep", 3],
    ["explain unix in two layers", 2],
    ["black holes, depth 4", 4],
    ["black holes with a depth of 2", 2],
    ["graph theory depth=1", 1],
    ["Rust ownership - ONE level", 1],
  ])("%s -> %i", (request, depth) => {
    expect(parseDepthHint(request)).toBe(depth);
  });

  it("is undefined when no depth is stated, so the default applies", () => {
    expect(parseDepthHint("explain black holes")).toBeUndefined();
    expect(parseDepthHint("the 3 laws of motion")).toBeUndefined();
  });

  it("clamps a stated depth into [1, MAX_DEPTH_CEILING], so a request cannot raise the ceiling", () => {
    expect(parseDepthHint("99 levels deep")).toBe(MAX_DEPTH_CEILING);
    expect(parseDepthHint("0 levels")).toBe(1);
  });
});

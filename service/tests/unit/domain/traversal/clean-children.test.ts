import { describe, expect, it } from "vitest";
import { cleanChildren } from "../../../../src/domain/traversal/clean-children";

describe("cleanChildren", () => {
  it("trims, collapses whitespace and drops empties, keeping order", () => {
    expect(cleanChildren(["  Light  reactions ", "", "   ", "Calvin cycle"], [])).toEqual([
      "Light reactions",
      "Calvin cycle",
    ]);
  });

  it("dedupes case- and whitespace-insensitively, keeping the first spelling", () => {
    expect(cleanChildren(["Calvin Cycle", "calvin   cycle", "CALVIN CYCLE"], [])).toEqual(["Calvin Cycle"]);
  });

  it("drops blocked topics (cycle guard)", () => {
    expect(cleanChildren(["Photosynthesis", "Plants", "Chlorophyll"], ["photosynthesis", " PLANTS "])).toEqual([
      "Chlorophyll",
    ]);
  });
});

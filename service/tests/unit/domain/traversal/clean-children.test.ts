import { describe, expect, it } from "vitest";
import { cleanChildren } from "../../../../src/domain/traversal/clean-children";

const t = (...topics: string[]) => topics.map((topic) => ({ topic }));

describe("cleanChildren", () => {
  it("trims, collapses whitespace and drops empties, keeping order", () => {
    expect(cleanChildren(t("  Light  reactions ", "", "   ", "Calvin cycle"), [])).toEqual(
      t("Light reactions", "Calvin cycle"),
    );
  });

  it("dedupes case- and whitespace-insensitively, keeping the first spelling", () => {
    expect(cleanChildren(t("Calvin Cycle", "calvin   cycle", "CALVIN CYCLE"), [])).toEqual(t("Calvin Cycle"));
  });

  it("drops blocked topics (cycle guard)", () => {
    expect(cleanChildren(t("Photosynthesis", "Plants", "Chlorophyll"), ["photosynthesis", " PLANTS "])).toEqual(
      t("Chlorophyll"),
    );
  });

  // C99: a child is now a topic WITH the brief its parent wrote; cleaning must not separate them.
  it("keeps every other field of an item with its cleaned topic", () => {
    expect(cleanChildren([{ topic: " Calvin  cycle ", brief: "Fixing carbon." }], [])).toEqual([
      { topic: "Calvin cycle", brief: "Fixing carbon." },
    ]);
  });
});

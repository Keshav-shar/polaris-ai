import { describe, expect, it } from "vitest";
import { buildContextSnippet } from "../../../../src/application/tree/context-snippet";
import type { NodeContext } from "../../../../src/domain/schemas/node.schema";

const ancestors = [
  { depth: 0, topic: "Biology", brief: "b0" },
  { depth: 1, topic: "Photosynthesis", brief: "b1" },
];

const ctx = (overrides: Partial<NodeContext>): NodeContext => ({
  depth: 0,
  maxDepth: 5,
  position: "normal",
  ancestors: [],
  ...overrides,
});

describe("buildContextSnippet", () => {
  it("shows (root) and a full expansion at the root", () => {
    const text = buildContextSnippet(ctx({}));
    expect(text).toContain("Depth 0 of 5 (5 levels remaining)");
    expect(text).toContain("Ancestor path (last 2 levels): (root).");
    expect(text).toContain("full set of distinct subtopics");
  });

  it("joins the ancestor trail and asks for fewer subtopics at the taper layer", () => {
    const text = buildContextSnippet(ctx({ depth: 4, position: "taper", ancestors }));
    expect(text).toContain("Biology → Photosynthesis");
    expect(text).toContain("fewer, more specific subtopics");
  });

  it("asks for no children at the leaf layer", () => {
    expect(buildContextSnippet(ctx({ depth: 5, position: "leaf", ancestors }))).toContain("empty children list");
  });

  it("never states a number of children", () => {
    for (const position of ["normal", "taper", "leaf"] as const) {
      expect(buildContextSnippet(ctx({ position }))).not.toMatch(/\b15\b|at most|up to \d/i);
    }
  });
});

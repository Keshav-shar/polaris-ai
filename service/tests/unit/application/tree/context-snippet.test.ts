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
  it("states the depth and asks for the full set of subtopics, each with a brief", () => {
    const text = buildContextSnippet(ctx({}));
    expect(text).toContain("Depth 0 of 5 (5 levels remaining)");
    expect(text).toContain("full set of distinct subtopics");
    expect(text).toContain("brief");
  });

  // C99: the taper node's children are never called, so their briefs must carry their whole scope.
  it("tells the taper layer that its children are the final layer and their briefs must stand alone", () => {
    const text = buildContextSnippet(ctx({ depth: 4, position: "taper", ancestors }));
    expect(text).toContain("fewer, more specific subtopics");
    expect(text).toContain("FINAL layer");
    expect(text).toContain("will not be broken down further");
  });

  // C103: the trail is model-written text; it belongs inside the <node> data block, not in the instructions.
  it("never repeats the ancestor trail, which lives inside the data block", () => {
    const text = buildContextSnippet(ctx({ depth: 4, position: "taper", ancestors }));
    expect(text).not.toContain("Biology");
    expect(text).not.toContain("Photosynthesis");
  });

  it("never states a number of children", () => {
    for (const position of ["normal", "taper", "leaf"] as const) {
      expect(buildContextSnippet(ctx({ position }))).not.toMatch(/\b15\b|at most|up to \d/i);
    }
  });
});

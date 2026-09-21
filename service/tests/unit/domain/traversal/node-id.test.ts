import { describe, expect, it } from "vitest";
import { childPath, normalizeTopic, pathLabel } from "../../../../src/domain/traversal/node-id";

const id = "2ed6657d-e927-568b-95e1-2665a8aea6a2";

describe("normalizeTopic", () => {
  it("trims, collapses whitespace and lower-cases", () => {
    expect(normalizeTopic("  Light   Reactions\n")).toBe("light reactions");
  });
});

describe("pathLabel / childPath", () => {
  it("builds ltree-safe labels from ids", () => {
    expect(pathLabel(id)).toBe("n_2ed6657de927568b95e12665a8aea6a2");
    expect(pathLabel(id)).toMatch(/^[A-Za-z0-9_]+$/);
  });

  it("appends the child label to the parent path", () => {
    expect(childPath("n_root", id)).toBe(`n_root.${pathLabel(id)}`);
  });
});

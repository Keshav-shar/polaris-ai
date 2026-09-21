import { describe, expect, it } from "vitest";
import { layerPosition } from "../../../../src/domain/traversal/layer-position";

function positions(maxDepth: number) {
  return Array.from({ length: maxDepth + 1 }, (_, depth) => layerPosition(depth, maxDepth));
}

describe("layerPosition", () => {
  it("maxDepth 1: root tapers, depth 1 is the leaf", () => {
    expect(positions(1)).toEqual(["taper", "leaf"]);
  });

  it("maxDepth 2: normal, taper, leaf", () => {
    expect(positions(2)).toEqual(["normal", "taper", "leaf"]);
  });

  it("maxDepth 5: the last two layers are taper + leaf", () => {
    expect(positions(5)).toEqual(["normal", "normal", "normal", "normal", "taper", "leaf"]);
  });

  it("anything at or beyond maxDepth is a leaf", () => {
    expect(layerPosition(7, 5)).toBe("leaf");
  });
});

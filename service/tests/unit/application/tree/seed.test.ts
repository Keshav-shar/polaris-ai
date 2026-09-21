import { describe, expect, it } from "vitest";
import { seedFor } from "../../../../src/application/tree/seed";

describe("seedFor", () => {
  it("is deterministic and differs between keys", () => {
    expect(seedFor("node-a")).toBe(seedFor("node-a"));
    expect(seedFor("node-a")).not.toBe(seedFor("node-b"));
  });

  it("returns a non-negative 32-bit integer", () => {
    for (const key of ["", "a", "2ed6657d-e927-568b-95e1-2665a8aea6a2"]) {
      const seed = seedFor(key);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

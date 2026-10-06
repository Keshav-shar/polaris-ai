import { describe, expect, it } from "vitest";
import { ARTICLE } from "../../../../src/config/constants";
import { articleBudget, budgetFitsSchema } from "../../../../src/domain/traversal/article-budget";

describe("articleBudget", () => {
  it.each([
    [0, 700, 1100],
    [1, 500, 850],
    [2, 500, 850],
    [3, 450, 750],
    [5, 450, 750],
    [6, 350, 600],
    [20, 350, 600],
  ])("gives %i writable children a band of %i-%i words", (children, minWords, maxWords) => {
    expect(articleBudget(children)).toEqual({ minWords, maxWords });
  });

  it("gives a LEAF the highest band of all, which is the whole point", () => {
    // Measurement showed a model left to itself writes leaves SHORTER than their parents, inverting the
    // design rule that a leaf conveys everything (docs/conflicts.md C85). This is the correction.
    const leaf = articleBudget(0);
    for (const children of [1, 2, 3, 5, 6, 12, 50]) {
      const interior = articleBudget(children);
      expect(leaf.minWords).toBeGreaterThan(interior.minWords);
      expect(leaf.maxWords).toBeGreaterThan(interior.maxWords);
    }
  });

  it("never widens as a node gains children: more handed down means less to write here", () => {
    let previous = articleBudget(0);
    for (const children of [1, 2, 3, 4, 5, 6, 7, 15]) {
      const current = articleBudget(children);
      expect(current.maxWords).toBeLessThanOrEqual(previous.maxWords);
      expect(current.minWords).toBeLessThanOrEqual(previous.minWords);
      previous = current;
    }
  });

  it("always asks for less than the schema's hard guard", () => {
    // If a band could exceed ARTICLE.MAX_WORDS the writer would be told to produce a draft that
    // ArticleOutput then rejects, burning a repair call every single time.
    for (const children of [0, 1, 2, 3, 5, 6, 20, 100]) {
      expect(articleBudget(children).maxWords).toBeLessThan(ARTICLE.MAX_WORDS);
    }
    expect(budgetFitsSchema()).toBe(true);
  });

  it("keeps every band a real range", () => {
    for (const children of [0, 1, 3, 6, 40]) {
      const band = articleBudget(children);
      expect(band.minWords).toBeGreaterThan(0);
      expect(band.maxWords).toBeGreaterThan(band.minWords);
    }
  });

  it("rejects a count that is not a non-negative integer", () => {
    expect(() => articleBudget(-1)).toThrow(RangeError);
    expect(() => articleBudget(1.5)).toThrow(RangeError);
    expect(() => articleBudget(Number.NaN)).toThrow(RangeError);
  });
});

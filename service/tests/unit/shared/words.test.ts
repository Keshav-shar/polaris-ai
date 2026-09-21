import { describe, expect, it } from "vitest";
import { countWords, truncateToWords } from "../../../src/shared/words";

describe("countWords", () => {
  it.each([
    ["", 0],
    ["   ", 0],
    ["one", 1],
    ["  two   words ", 2],
    ["tabs\tand\nnewlines count", 4],
  ])("%j has %i words", (text, expected) => {
    expect(countWords(text)).toBe(expected);
  });
});

describe("truncateToWords", () => {
  it("returns the text unchanged when within the limit", () => {
    expect(truncateToWords("a b c", 3)).toBe("a b c");
  });

  it("keeps the first n words joined by single spaces", () => {
    expect(truncateToWords("a  b\nc d", 3)).toBe("a b c");
  });
});

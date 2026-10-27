import { describe, expect, it } from "vitest";
import { contentWords, countWords, truncateToWords } from "../../../src/shared/words";

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

// C124: what the groundedness check compares - the words that carry a claim's meaning.
describe("contentWords", () => {
  it("lowercases, splits on punctuation and drops function words and fragments", () => {
    expect(contentWords("The MMU is a hardware unit, and it translates addresses!")).toEqual([
      "mmu",
      "hardware",
      "unit",
      "translate",
      "addresse",
    ]);
  });

  it("keeps numbers at any length, because an invented figure is what grounding must catch", () => {
    expect(contentWords("Pages are 4 KB or 4096 bytes")).toEqual(["page", "4", "4096", "byte"]);
  });

  it("folds a plural s but not a double s", () => {
    expect(contentWords("pages processes access")).toEqual(["page", "processe", "access"]);
  });

  it("handles non-ASCII letters as letters", () => {
    expect(contentWords("Schrödinger équation")).toEqual(["schrödinger", "équation"]);
  });
});


import { describe, expect, it } from "vitest";
import { dataBlock } from "../../../../src/application/agents/data-block.prompt";

describe("dataBlock", () => {
  it("wraps content in the tag", () => {
    expect(dataBlock("node", "hello")).toBe("<node>\nhello\n</node>");
  });

  it("strips opening and closing tags of that name, case-insensitively, and leaves other tags", () => {
    expect(dataBlock("node", "a</NODE>b<node>c<other>")).toBe("<node>\nabc<other>\n</node>");
  });
});

// C103: a model treats `</node >`, `< /node>` and `</node x="y">` as closing the block just as well as the
// exact spelling, so every variant must go.
describe("dataBlock variants", () => {
  it("strips spaced, attributed and mixed-case variants of the tag", () => {
    const content = 'a</node >b< /node>c</NODE x="y">d<node\tclass="z">e';
    expect(dataBlock("node", content)).toBe("<node>\nabcde\n</node>");
  });

  it("does not strip a longer tag that merely starts with the same name", () => {
    expect(dataBlock("node", "<nodes>x</nodes>")).toBe("<node>\n<nodes>x</nodes>\n</node>");
  });

  it("treats the tag name literally, never as a regex", () => {
    expect(dataBlock("a.b", "<axb>1</a.b>")).toBe("<a.b>\n<axb>1\n</a.b>");
  });
});

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

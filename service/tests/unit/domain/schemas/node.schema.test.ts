import { describe, expect, it } from "vitest";
import {
  Brief,
  ExpandOutput,
  NodeContext,
  ParsedRequest,
  TreeNode,
} from "../../../../src/domain/schemas/node.schema";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
const ancestor = (depth: number) => ({ depth, topic: `t${depth}`, brief: "b" });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("Brief", () => {
  it("accepts 49 words and rejects 50", () => {
    expect(Brief.safeParse(words(49)).success).toBe(true);
    expect(Brief.safeParse(words(50)).success).toBe(false);
  });

  it("rejects an empty brief", () => {
    expect(Brief.safeParse("   ").success).toBe(false);
  });
});

describe("ParsedRequest", () => {
  it("defaults maxDepth to 5 and trims the topic", () => {
    expect(ParsedRequest.parse({ topic: "  photosynthesis " })).toEqual({ topic: "photosynthesis", maxDepth: 5 });
  });

  it("rejects depths outside 1..6", () => {
    expect(ParsedRequest.safeParse({ topic: "x", maxDepth: 0 }).success).toBe(false);
    expect(ParsedRequest.safeParse({ topic: "x", maxDepth: 7 }).success).toBe(false);
  });
});

describe("NodeContext", () => {
  it("accepts at most two ancestors", () => {
    const base = { depth: 3, maxDepth: 5, position: "normal" as const };
    expect(NodeContext.safeParse({ ...base, ancestors: [ancestor(1), ancestor(2)] }).success).toBe(true);
    expect(NodeContext.safeParse({ ...base, ancestors: [ancestor(0), ancestor(1), ancestor(2)] }).success).toBe(false);
  });
});

describe("ExpandOutput", () => {
  it("validates the brief inside the output", () => {
    expect(ExpandOutput.safeParse({ brief: words(10), children: ["a"] }).success).toBe(true);
    expect(ExpandOutput.safeParse({ brief: words(60), children: [] }).success).toBe(false);
  });
});

describe("TreeNode", () => {
  it("parses a recursive tree", () => {
    const tree = {
      id: id(1),
      topic: "root",
      depth: 0,
      brief: "r",
      status: "done",
      children: [{ id: id(2), topic: "child", depth: 1, brief: "c", status: "expanded", children: [] }],
    };
    expect(TreeNode.parse(tree).children[0]?.topic).toBe("child");
  });

  it("rejects an invalid nested child", () => {
    const tree = {
      id: id(1),
      topic: "root",
      depth: 0,
      brief: "r",
      status: "done",
      children: [{ id: "not-a-uuid", topic: "c", depth: 1, brief: "c", status: "done", children: [] }],
    };
    expect(TreeNode.safeParse(tree).success).toBe(false);
  });
});

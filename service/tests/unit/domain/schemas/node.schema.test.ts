import { describe, expect, it } from "vitest";
import {
  Brief,
  ChildDraft,
  ExpandOutput,
  NodeContext,
  RootExpandOutput,
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

describe("NodeContext", () => {
  it("accepts at most two ancestors", () => {
    const base = { depth: 3, maxDepth: 5, position: "normal" as const };
    expect(NodeContext.safeParse({ ...base, ancestors: [ancestor(1), ancestor(2)] }).success).toBe(true);
    expect(NodeContext.safeParse({ ...base, ancestors: [ancestor(0), ancestor(1), ancestor(2)] }).success).toBe(false);
  });
});

describe("ExpandOutput / RootExpandOutput", () => {
  it("asks an interior call for children with briefs, and leaves per-child validity to the verifier", () => {
    expect(ExpandOutput.safeParse({ children: [{ topic: "a", brief: words(10) }] }).success).toBe(true);
    // Lenient on purpose: one long brief must not fail the parse and cost a repair call (C99).
    expect(ExpandOutput.safeParse({ children: [{ topic: "a", brief: words(60) }] }).success).toBe(true);
    // The old shape - bare topic strings - is a different reply and is repaired.
    expect(ExpandOutput.safeParse({ children: ["a"] }).success).toBe(false);
  });

  it("asks the root call for a topic and brief as well (C100)", () => {
    expect(RootExpandOutput.safeParse({ topic: "T", brief: "b", children: [] }).success).toBe(true);
    expect(RootExpandOutput.safeParse({ brief: "b", children: [] }).success).toBe(false);
  });
});

describe("ChildDraft", () => {
  it("enforces the brief and topic limits a stored child must meet", () => {
    expect(ChildDraft.safeParse({ topic: "a", brief: words(10) }).success).toBe(true);
    expect(ChildDraft.safeParse({ topic: "a", brief: words(60) }).success).toBe(false);
    expect(ChildDraft.safeParse({ topic: " ", brief: "b" }).success).toBe(false);
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

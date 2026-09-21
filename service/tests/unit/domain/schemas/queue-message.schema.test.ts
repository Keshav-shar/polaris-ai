import { describe, expect, it } from "vitest";
import { NodeMessage } from "../../../../src/domain/schemas/queue-message.schema";

const message = {
  pass: "construct",
  runId: "00000000-0000-4000-8000-000000000001",
  nodeId: "00000000-0000-4000-8000-000000000002",
  parentId: null,
  topic: "Photosynthesis",
  depth: 0,
  maxDepth: 3,
  path: "n_00000000000040008000000000000002",
  ancestors: [],
};

describe("NodeMessage", () => {
  it("accepts a root construct message", () => {
    expect(NodeMessage.parse(message).parentId).toBeNull();
  });

  it("rejects a non-UUID node id", () => {
    expect(NodeMessage.safeParse({ ...message, nodeId: "node-1" }).success).toBe(false);
  });

  it("rejects an unknown pass", () => {
    expect(NodeMessage.safeParse({ ...message, pass: "quiz" }).success).toBe(false);
  });

  it("rejects more than two ancestors", () => {
    const ancestors = [0, 1, 2].map((depth) => ({ depth, topic: `t${depth}`, brief: "b" }));
    expect(NodeMessage.safeParse({ ...message, depth: 3, ancestors }).success).toBe(false);
  });

  it("rejects a maxDepth above the ceiling", () => {
    expect(NodeMessage.safeParse({ ...message, maxDepth: 7 }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { childConstructMessage, rootConstructMessage } from "../../../../src/application/tree/messages";
import { ANCESTOR_WINDOW, ROOT_DEPTH } from "../../../../src/config/constants";
import { NodeMessage } from "../../../../src/domain/schemas/queue-message.schema";

const runId = "11111111-1111-4111-8111-111111111111";
const root = rootConstructMessage(runId, { topic: "photosynthesis", maxDepth: 3 });

describe("rootConstructMessage", () => {
  it("is a valid construct message with no parent and no ancestors", () => {
    expect(() => NodeMessage.parse(root)).not.toThrow();
    expect(root).toMatchObject({ pass: "construct", parentId: null, depth: ROOT_DEPTH, ancestors: [] });
  });

  it("derives the same node id for the same run", () => {
    expect(rootConstructMessage(runId, { topic: "other", maxDepth: 1 }).nodeId).toBe(root.nodeId);
  });
});

describe("childConstructMessage", () => {
  it("derives a deterministic id from the parent and the normalized topic", () => {
    const a = childConstructMessage(root, "brief", "Light Reactions");
    const b = childConstructMessage(root, "a different brief", "  light   reactions  ");
    // Same parent + same normalized topic => same id, which is what makes a redelivered parent harmless.
    expect(a.nodeId).toBe(b.nodeId);
    expect(childConstructMessage(root, "brief", "calvin cycle").nodeId).not.toBe(a.nodeId);
  });

  it("extends the ltree path and the depth", () => {
    const child = childConstructMessage(root, "brief", "light reactions");
    expect(child.depth).toBe(root.depth + 1);
    expect(child.path.startsWith(`${root.path}.`)).toBe(true);
    expect(child.path.split(".").every((label) => /^[A-Za-z0-9_]+$/.test(label))).toBe(true);
  });

  it("never carries more than ANCESTOR_WINDOW ancestors, however deep the chain", () => {
    let current = root;
    for (let depth = 0; depth < 6; depth++) {
      current = childConstructMessage(current, `brief ${depth}`, `topic ${depth}`);
      expect(() => NodeMessage.parse(current)).not.toThrow();
      expect(current.ancestors.length).toBeLessThanOrEqual(ANCESTOR_WINDOW);
    }
    // The window keeps the NEAREST levels: the last two parents, not the first two.
    expect(current.ancestors.map((a) => a.topic)).toEqual(["topic 3", "topic 4"]);
  });

  it("passes the parent's own brief down as ancestor context", () => {
    const child = childConstructMessage(root, "the root brief", "light reactions");
    expect(child.ancestors).toEqual([{ depth: root.depth, topic: root.topic, brief: "the root brief" }]);
  });
});

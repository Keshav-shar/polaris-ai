import { describe, expect, it } from "vitest";
import { childNodeId, rootNodeId } from "../../../../src/application/tree/node-ids";

const runId = "0f1e2d3c-4b5a-4968-8776-655443322110";
const otherRun = "1f1e2d3c-4b5a-4968-8776-655443322110";

describe("node ids", () => {
  it("gives a stable root id per run", () => {
    expect(rootNodeId(runId)).toBe(rootNodeId(runId));
    expect(rootNodeId(runId)).not.toBe(rootNodeId(otherRun));
  });

  it("gives the same child id for the same normalized topic under the same parent", () => {
    const parent = rootNodeId(runId);
    expect(childNodeId(runId, parent, "Calvin Cycle")).toBe(childNodeId(runId, parent, "  calvin   cycle "));
  });

  it("gives different ids under a different parent or run", () => {
    const parent = rootNodeId(runId);
    const other = childNodeId(runId, parent, "Leaves");
    expect(childNodeId(runId, parent, "Calvin cycle")).not.toBe(childNodeId(runId, other, "Calvin cycle"));
    expect(childNodeId(runId, parent, "Calvin cycle")).not.toBe(childNodeId(otherRun, parent, "Calvin cycle"));
  });
});

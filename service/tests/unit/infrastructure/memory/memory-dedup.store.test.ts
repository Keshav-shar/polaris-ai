import { describe, expect, it } from "vitest";
import { createMemoryDedupStore } from "../../../../src/infrastructure/memory/memory-dedup.store";

const runId = "run-1";
const parentA = "parent-a";
const parentB = "parent-b";

describe("memory dedup store", () => {
  it("gives a topic to the first claimant only", async () => {
    const dedup = createMemoryDedupStore();
    expect(await dedup.claimTopics(runId, parentA, ["light reactions", "calvin cycle"])).toEqual([
      "light reactions",
      "calvin cycle",
    ]);
    // A different branch asking for the same topic gets nothing: dedup is tree-wide, not per-parent.
    expect(await dedup.claimTopics(runId, parentB, ["calvin cycle", "chlorophyll"])).toEqual(["chlorophyll"]);
  });

  it("rule 7: a retried parent keeps the topics it already claimed", async () => {
    const dedup = createMemoryDedupStore();
    const first = await dedup.claimTopics(runId, parentA, ["light reactions", "calvin cycle"]);
    // Same parent, same request - a redelivery must not starve itself of its own children.
    expect(await dedup.claimTopics(runId, parentA, ["light reactions", "calvin cycle"])).toEqual(first);
  });

  it("matches on the normalized topic but returns the original strings", async () => {
    const dedup = createMemoryDedupStore();
    expect(await dedup.claimTopics(runId, parentA, ["Light Reactions"])).toEqual(["Light Reactions"]);
    expect(await dedup.claimTopics(runId, parentB, ["  light   REACTIONS "])).toEqual([]);
  });

  it("keeps runs apart", async () => {
    const dedup = createMemoryDedupStore();
    await dedup.claimTopics(runId, parentA, ["calvin cycle"]);
    expect(await dedup.claimTopics("run-2", parentA, ["calvin cycle"])).toEqual(["calvin cycle"]);
  });

  it("preserves input order", async () => {
    const dedup = createMemoryDedupStore();
    await dedup.claimTopics(runId, parentB, ["b"]);
    expect(await dedup.claimTopics(runId, parentA, ["a", "b", "c"])).toEqual(["a", "c"]);
  });
});

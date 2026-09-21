import { describe, expect, it } from "vitest";
import { applyConsolidation, createConsolidatorAgent } from "../../../../src/application/agents/consolidator.agent";
import { buildConsolidatorUserPrompt } from "../../../../src/application/agents/consolidator.prompt";
import { EXPAND } from "../../../../src/config/constants";
import { ConsolidatorOutput } from "../../../../src/domain/schemas/agent-io.schema";
import { fakeGenerate } from "../../../fixtures/fake-generate";

const children = ["Light reactions", "Light-dependent reactions", "Calvin cycle", "Stock market", "Chlorophyll"];

describe("applyConsolidation", () => {
  it("names merged groups with the new topic, keeps single members' original text, drops unlisted", () => {
    const result = applyConsolidation(children, {
      groups: [
        { members: [1, 2], topic: "Light-dependent reactions (overview)" },
        { members: [3], topic: "calvin cycle (renamed)" },
        { members: [5], topic: "Chlorophyll" },
      ],
    });
    expect(result).toEqual(["Light-dependent reactions (overview)", "Calvin cycle", "Chlorophyll"]);
  });

  it("rejects out-of-range and reused indices", () => {
    expect(() => applyConsolidation(children, { groups: [{ members: [6], topic: "x" }] })).toThrow(RangeError);
    expect(() =>
      applyConsolidation(children, { groups: [{ members: [1], topic: "a" }, { members: [1, 2], topic: "b" }] }),
    ).toThrow(RangeError);
  });

  it("caps the result at EXPAND.MAX_CHILDREN and re-applies the cycle guard", () => {
    const many = Array.from({ length: 20 }, (_, i) => `Topic ${i}`);
    const groups = many.map((_, i) => ({ members: [i + 1], topic: "ignored" }));
    expect(applyConsolidation(many, { groups })).toHaveLength(EXPAND.MAX_CHILDREN);
    expect(applyConsolidation(children, { groups: [{ members: [1, 2], topic: "Biology" }] }, ["biology"])).toEqual([]);
  });
});

describe("createConsolidatorAgent", () => {
  it("sends numbered children in a data block and maps the reply", async () => {
    const { generate, requests } = fakeGenerate(async () => ({
      groups: [{ members: [1, 2], topic: "Light reactions" }, { members: [3], topic: "Calvin cycle" }],
    }));
    const kept = await createConsolidatorAgent({ generate }).consolidate({
      topic: "Photosynthesis",
      ancestors: [],
      children,
    });
    expect(kept).toEqual(["Light reactions", "Calvin cycle"]);
    expect(requests[0]!.label).toBe("consolidate");
    expect(requests[0]!.schema).toBe(ConsolidatorOutput);
    expect(requests[0]!.user).toBe(buildConsolidatorUserPrompt("Photosynthesis", [], children));
    expect(requests[0]!.user).toContain("1. Light reactions\n2. Light-dependent reactions");
  });
});

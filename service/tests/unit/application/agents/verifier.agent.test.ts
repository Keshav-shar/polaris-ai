import { describe, expect, it } from "vitest";
import { verifyExpansion } from "../../../../src/application/agents/verifier.agent";
import { ConstructionRejectedError } from "../../../../src/domain/errors/construction-rejected.error";
import { DomainError } from "../../../../src/domain/errors/domain-error";

const ancestors = [{ depth: 0, topic: "Biology", brief: "Life." }];
const base = { topic: "Photosynthesis", ancestors, position: "normal" as const };

describe("verifyExpansion", () => {
  it("cleans children: dedupe, empties, own topic and ancestor topics", () => {
    const { output, strippedLeafChildren } = verifyExpansion({
      ...base,
      output: { brief: "How plants make sugar.", children: ["Calvin cycle", "calvin  CYCLE", "", "photosynthesis", "BIOLOGY", "Chlorophyll"] },
    });
    expect(output.children).toEqual(["Calvin cycle", "Chlorophyll"]);
    expect(strippedLeafChildren).toBe(0);
  });

  it("forces [] at the leaf layer and reports how many were stripped", () => {
    const { output, strippedLeafChildren } = verifyExpansion({
      ...base,
      position: "leaf",
      output: { brief: "Leaf brief.", children: ["A", "B"] },
    });
    expect(output).toEqual({ brief: "Leaf brief.", children: [] });
    expect(strippedLeafChildren).toBe(2);
  });

  it("rejects an invalid brief with ConstructionRejectedError", () => {
    const error = (() => {
      try {
        verifyExpansion({ ...base, output: { brief: "word ".repeat(60), children: [] } });
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ConstructionRejectedError);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: "CONSTRUCTION_REJECTED" });
  });

  it("does not apply the children cap", () => {
    const children = Array.from({ length: 20 }, (_, i) => `Topic ${i}`);
    expect(verifyExpansion({ ...base, output: { brief: "b", children } }).output.children).toHaveLength(20);
  });
});

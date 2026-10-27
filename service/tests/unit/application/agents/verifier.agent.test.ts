import { describe, expect, it } from "vitest";
import { verifyExpansion } from "../../../../src/application/agents/verifier.agent";
import { TOPIC_MAX_CHARS } from "../../../../src/config/constants";
import { ConstructionRejectedError } from "../../../../src/domain/errors/construction-rejected.error";
import { DomainError } from "../../../../src/domain/errors/domain-error";

const ancestors = [{ depth: 0, topic: "Biology", brief: "Life." }];
const base = { topic: "Photosynthesis", ancestors, isRoot: false };
const child = (topic: string, brief = `About ${topic}.`) => ({ topic, brief });

function rejection(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("verifyExpansion", () => {
  it("cleans children: dedupe, empties, own topic and ancestor topics - briefs travel with them", () => {
    const { output, droppedChildren } = verifyExpansion({
      ...base,
      output: {
        children: [
          child("Calvin cycle"),
          child("calvin  CYCLE"),
          child(""),
          child("photosynthesis"),
          child("BIOLOGY"),
          child("Chlorophyll"),
        ],
      },
    });
    expect(output).toEqual({ children: [child("Calvin cycle"), child("Chlorophyll")] });
    expect(droppedChildren).toBe(0);
  });

  // C99: the final layer is never called, so a child's brief is the ONLY brief it will ever have. A bad one
  // is dropped (and counted) instead of failing the node, which would spend a repair or a redelivery.
  it("drops a child whose brief or topic is invalid, and counts it", () => {
    const { output, droppedChildren } = verifyExpansion({
      ...base,
      output: {
        children: [
          child("Calvin cycle"),
          child("Light reactions", "word ".repeat(60)),
          child("Stroma", ""),
          child("x".repeat(TOPIC_MAX_CHARS + 1)),
        ],
      },
    });
    expect(output.children).toEqual([child("Calvin cycle")]);
    expect(droppedChildren).toBe(3);
  });

  it("rejects a node whose every child is unusable, so the roll is retried rather than made a leaf", () => {
    const error = rejection(() =>
      verifyExpansion({ ...base, output: { children: [child("A", ""), child("B", "word ".repeat(60))] } }),
    );
    expect(error).toBeInstanceOf(ConstructionRejectedError);
  });

  it("accepts a list that only repeats the node or its ancestors: nothing new below it, not a bad roll", () => {
    const { output } = verifyExpansion({ ...base, output: { children: [child("Photosynthesis"), child("Biology")] } });
    expect(output).toEqual({ children: [] });
  });

  it("accepts an honest empty list: the node simply has no subtopics", () => {
    expect(verifyExpansion({ ...base, output: { children: [] } }).output).toEqual({ children: [] });
  });

  it("ignores a brief or topic on a non-root reply: the node's own brief came from its parent", () => {
    const { output } = verifyExpansion({
      ...base,
      output: { topic: "Renamed", brief: "Self-written.", children: [child("Calvin cycle")] },
    });
    expect(output).toEqual({ children: [child("Calvin cycle")] });
  });

  describe("root (C100)", () => {
    const root = { topic: "teach me photosynthesis", ancestors: [], isRoot: true };

    it("returns the named topic and the root brief, and blocks the named topic as a child", () => {
      const { output } = verifyExpansion({
        ...root,
        output: {
          topic: "  Photosynthesis ",
          brief: "How plants make sugar.",
          children: [child("Photosynthesis"), child("Calvin cycle")],
        },
      });
      expect(output).toEqual({
        topic: "Photosynthesis",
        brief: "How plants make sugar.",
        children: [child("Calvin cycle")],
      });
    });

    it("rejects an invalid root brief with ConstructionRejectedError", () => {
      const error = rejection(() =>
        verifyExpansion({ ...root, output: { topic: "P", brief: "word ".repeat(60), children: [] } }),
      );
      expect(error).toBeInstanceOf(ConstructionRejectedError);
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({ code: "CONSTRUCTION_REJECTED" });
    });

    it("rejects a missing or over-long topic", () => {
      expect(rejection(() => verifyExpansion({ ...root, output: { brief: "b", children: [] } }))).toBeInstanceOf(
        ConstructionRejectedError,
      );
      expect(
        rejection(() =>
          verifyExpansion({ ...root, output: { topic: "x".repeat(TOPIC_MAX_CHARS + 1), brief: "b", children: [] } }),
        ),
      ).toBeInstanceOf(ConstructionRejectedError);
    });
  });

  it("does not apply the children cap", () => {
    const children = Array.from({ length: 20 }, (_, i) => child(`Topic ${i}`));
    expect(verifyExpansion({ ...base, output: { children } }).output.children).toHaveLength(20);
  });
});

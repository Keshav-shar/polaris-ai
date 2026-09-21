import { describe, expect, it } from "vitest";
import { QuotaExhaustedError } from "../../../../src/domain/errors/quota-exhausted.error";
import { createParserAgent, toParsedRequest } from "../../../../src/application/agents/parser.agent";
import { DEFAULT_MAX_DEPTH, MAX_DEPTH_CEILING } from "../../../../src/config/constants";
import { RawParserOutput } from "../../../../src/domain/schemas/agent-io.schema";
import { fakeGenerate, fakeLogger } from "../../../fixtures/fake-generate";

describe("toParsedRequest", () => {
  it.each([
    [null, DEFAULT_MAX_DEPTH],
    [0, 1],
    [-2, 1],
    [3, 3],
    [99, MAX_DEPTH_CEILING],
  ])("maps maxDepth %s to %s", (maxDepth, expected) => {
    expect(toParsedRequest({ topic: "photosynthesis", maxDepth }).maxDepth).toBe(expected);
  });

  it("trims the topic", () => {
    expect(toParsedRequest({ topic: "  photosynthesis \n", maxDepth: 2 }).topic).toBe("photosynthesis");
  });

  it("throws on an empty topic", () => {
    expect(() => toParsedRequest({ topic: "   ", maxDepth: 2 })).toThrow();
  });
});

describe("createParserAgent", () => {
  it("maps the generator output and asks with the parser schema and label", async () => {
    const { generate, requests } = fakeGenerate(async () => ({ topic: " Photosynthesis ", maxDepth: 3 }));
    const { logger, warnings } = fakeLogger();
    const parser = createParserAgent({ generate, logger });

    await expect(parser.parse("teach me photosynthesis, 3 levels deep")).resolves.toEqual({
      topic: "Photosynthesis",
      maxDepth: 3,
    });
    expect(requests[0]!.label).toBe("parser");
    expect(requests[0]!.schema).toBe(RawParserOutput);
    expect(requests[0]!.user).toContain("teach me photosynthesis, 3 levels deep");
    expect(warnings).toEqual([]);
  });

  it("falls back to the trimmed prompt and the default depth when generation fails", async () => {
    const { generate } = fakeGenerate(() => Promise.reject(new Error("LLM down")));
    const { logger, warnings } = fakeLogger();
    const parser = createParserAgent({ generate, logger });

    await expect(parser.parse("  black holes  ")).resolves.toEqual({
      topic: "black holes",
      maxDepth: DEFAULT_MAX_DEPTH,
    });
    expect(warnings.map((w) => w.msg)).toEqual(["parser fallback"]);
  });

  it("falls back when the model returns an empty topic", async () => {
    const { generate } = fakeGenerate(async () => ({ topic: "", maxDepth: null }));
    const { logger, warnings } = fakeLogger();
    await expect(createParserAgent({ generate, logger }).parse("black holes")).resolves.toEqual({
      topic: "black holes",
      maxDepth: DEFAULT_MAX_DEPTH,
    });
    expect(warnings).toHaveLength(1);
  });

  it("rethrows an exhausted daily quota instead of falling back", async () => {
    const { generate } = fakeGenerate(async () => {
      throw new QuotaExhaustedError("gemini-3.6-flash");
    });
    const { logger, warnings } = fakeLogger();
    const agent = createParserAgent({ generate, logger });
    // Falling back here would create a run whose every node then dies the same way.
    await expect(agent.parse("photosynthesis")).rejects.toThrow(QuotaExhaustedError);
    expect(warnings).toEqual([]);
  });
});

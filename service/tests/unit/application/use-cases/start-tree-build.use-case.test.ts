import { describe, expect, it } from "vitest";
import {
  createStartTreeBuild,
  provisionalTopic,
} from "../../../../src/application/use-cases/start-tree-build.use-case";
import { DEFAULT_MAX_DEPTH, MAX_DEPTH_CEILING, TOPIC_MAX_CHARS } from "../../../../src/config/constants";
import { RunInProgressError } from "../../../../src/domain/errors/run-in-progress.error";
import { createMemoryNodeQueue } from "../../../../src/infrastructure/memory/memory-node-queue.adapter";
import { createMemoryRunRepository } from "../../../../src/infrastructure/memory/memory-run.repository";
import { fakeLogger } from "../../../fixtures/fake-generate";

const runId = "11111111-1111-4111-8111-111111111111";

function setup(dailyRequestBudget?: number, maxConcurrentRuns?: number, runRepo = createMemoryRunRepository()) {
  const queue = createMemoryNodeQueue();
  const { logger, logs } = fakeLogger();
  const startTreeBuild = createStartTreeBuild({
    ids: { next: () => runId },
    runRepo,
    queue,
    logger,
    dailyRequestBudget,
    maxConcurrentRuns,
  });
  return { queue, runRepo, startTreeBuild, logs };
}

describe("start-tree-build use-case", () => {
  // C100: there is no LLM dependency at all any more - the deps type has no parser and no generator - so an
  // accepted request costs zero provider requests inside the HTTP call, as a refused one always did.
  it("creates the run and sends exactly one root message carrying the raw request", async () => {
    const { queue, runRepo, startTreeBuild } = setup();
    const result = await startTreeBuild.execute("  teach me photosynthesis  ");

    expect(result).toEqual({ runId });
    expect(await runRepo.get(runId)).toMatchObject({
      topic: "teach me photosynthesis",
      maxDepth: DEFAULT_MAX_DEPTH,
      status: "constructing",
    });
    expect(queue.size()).toBe(1);
    const [receipt] = await queue.receive(1);
    expect(receipt?.message).toMatchObject({
      pass: "construct",
      runId,
      parentId: null,
      depth: 0,
      maxDepth: DEFAULT_MAX_DEPTH,
      request: "teach me photosynthesis",
    });
  });

  it("takes the depth stated in the prompt when there is no override", async () => {
    const { runRepo, startTreeBuild } = setup();
    await startTreeBuild.execute("teach me unix, 2 levels deep");
    expect((await runRepo.get(runId))?.maxDepth).toBe(2);
  });

  it("lets an override win over a stated depth, and refuses one outside the range rather than clamping it", async () => {
    const { runRepo, startTreeBuild } = setup();
    await startTreeBuild.execute("teach me unix, 4 levels deep", { maxDepth: 1 });
    expect((await runRepo.get(runId))?.maxDepth).toBe(1);

    // The ceiling is cost safety: an override must not be a way around it, nor silently become another depth.
    await expect(setup().startTreeBuild.execute("x", { maxDepth: MAX_DEPTH_CEILING + 5 })).rejects.toThrow(RangeError);
    await expect(setup().startTreeBuild.execute("x", { maxDepth: 0 })).rejects.toThrow(RangeError);
  });

  it("warns about an over-budget build but still starts it", async () => {
    // depth 3 is ~187 calls (31 expand + 156 writer) against a 20/day budget. The warning is the whole
    // intervention: shrinking the caller's maxDepth is worse than a partial tree they asked for (C57).
    const { runRepo, startTreeBuild, logs } = setup(20);
    await startTreeBuild.execute("photosynthesis", { maxDepth: 3 });

    const warning = logs.find((entry) => entry.msg === "build exceeds the provider daily budget");
    expect(warning?.level).toBe("warn");
    expect(warning?.context).toMatchObject({ maxDepth: 3, estimatedCalls: 187, dailyRequestBudget: 20 });
    expect(await runRepo.get(runId)).toMatchObject({ maxDepth: 3, status: "constructing" });
  });

  it("only logs an estimate when the build fits the budget, or no budget is known", async () => {
    const within = setup(20);
    await within.startTreeBuild.execute("photosynthesis", { maxDepth: 1 });
    expect(within.logs.map((entry) => entry.msg)).toContain("build estimate");
    expect(within.logs.some((entry) => entry.level === "warn")).toBe(false);

    const unknown = setup();
    await unknown.startTreeBuild.execute("photosynthesis");
    expect(unknown.logs.some((entry) => entry.level === "warn")).toBe(false);
  });

  describe("concurrency guard", () => {
    it("refuses a second run while one is constructing", async () => {
      const first = setup(undefined, 1);
      await first.startTreeBuild.execute("photosynthesis");

      const second = setup(undefined, 1, first.runRepo);
      await expect(second.startTreeBuild.execute("black holes")).rejects.toBeInstanceOf(RunInProgressError);
      expect(second.queue.size()).toBe(0);
    });

    it("lets the next run start once the first leaves constructing", async () => {
      const first = setup(undefined, 1);
      await first.startTreeBuild.execute("photosynthesis");
      await first.runRepo.setStatus(runId, "constructed");

      const second = setup(undefined, 1, first.runRepo);
      await expect(second.startTreeBuild.execute("black holes")).resolves.toMatchObject({ runId });
    });

    it("does not guard at all when no limit is configured", async () => {
      const first = setup();
      await first.startTreeBuild.execute("photosynthesis");
      await expect(setup(undefined, undefined, first.runRepo).startTreeBuild.execute("black holes")).resolves.toBeDefined();
    });
  });
});

describe("provisionalTopic", () => {
  it("collapses whitespace and keeps a short request whole", () => {
    expect(provisionalTopic("  teach   me\nunix ")).toBe("teach me unix");
  });

  it("cuts a long request at a word boundary within TOPIC_MAX_CHARS", () => {
    const topic = provisionalTopic("word ".repeat(100));
    expect(topic.length).toBeLessThanOrEqual(TOPIC_MAX_CHARS);
    expect(topic.endsWith("word…")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { createStartTreeBuild } from "../../../../src/application/use-cases/start-tree-build.use-case";
import { MAX_DEPTH_CEILING } from "../../../../src/config/constants";
import { QuotaExhaustedError } from "../../../../src/domain/errors/quota-exhausted.error";
import { RunInProgressError } from "../../../../src/domain/errors/run-in-progress.error";
import { createMemoryNodeQueue } from "../../../../src/infrastructure/memory/memory-node-queue.adapter";
import { createMemoryRunRepository } from "../../../../src/infrastructure/memory/memory-run.repository";
import { fakeLogger } from "../../../fixtures/fake-generate";

const runId = "11111111-1111-4111-8111-111111111111";

function setup(
  parse: (raw: string) => Promise<{ topic: string; maxDepth: number }>,
  dailyRequestBudget?: number,
  maxConcurrentRuns?: number,
) {
  const queue = createMemoryNodeQueue();
  const runRepo = createMemoryRunRepository();
  const { logger, logs } = fakeLogger();
  const startTreeBuild = createStartTreeBuild({
    parser: { parse },
    ids: { next: () => runId },
    runRepo,
    queue,
    logger,
    dailyRequestBudget,
    maxConcurrentRuns,
  });
  return { queue, runRepo, startTreeBuild, logs };
}

const ok = async (raw: string) => ({ topic: raw, maxDepth: 3 });

describe("start-tree-build use-case", () => {
  it("creates the run and sends exactly one root message", async () => {
    const { queue, runRepo, startTreeBuild } = setup(ok);
    const result = await startTreeBuild.execute("photosynthesis");

    expect(result).toEqual({ runId });
    expect(await runRepo.get(runId)).toMatchObject({ topic: "photosynthesis", maxDepth: 3, status: "constructing" });
    expect(queue.size()).toBe(1);
    const [receipt] = await queue.receive(1);
    expect(receipt?.message).toMatchObject({ pass: "construct", runId, parentId: null, depth: 0, maxDepth: 3 });
  });

  it("overrides the parsed depth when a caller asks, clamped to the ceiling", async () => {
    const { runRepo, startTreeBuild } = setup(ok);
    await startTreeBuild.execute("photosynthesis", { maxDepth: 1 });
    expect((await runRepo.get(runId))?.maxDepth).toBe(1);

    const second = setup(ok);
    // The ceiling is cost safety: an override must not be a way around it.
    await expect(second.startTreeBuild.execute("x", { maxDepth: MAX_DEPTH_CEILING + 5 })).rejects.toThrow();
  });

  it("warns about an over-budget build but still starts it", async () => {
    // depth 3 is ~156 expand calls against Gemina's 20/day. The warning is the whole intervention: the
    // run must still happen, because shrinking the caller's maxDepth behind their back is worse than a
    // partial tree they asked for (docs/conflicts.md C57).
    const { runRepo, startTreeBuild, logs } = setup(ok, 20);
    await startTreeBuild.execute("photosynthesis");

    const warning = logs.find((entry) => entry.msg === "build exceeds the provider daily budget");
    expect(warning?.level).toBe("warn");
    expect(warning?.context).toMatchObject({ maxDepth: 3, estimatedCalls: 156, dailyRequestBudget: 20 });
    expect(await runRepo.get(runId)).toMatchObject({ maxDepth: 3, status: "constructing" });
  });

  it("only logs an estimate when the build fits the budget, or no budget is known", async () => {
    const within = setup(async (raw) => ({ topic: raw, maxDepth: 1 }), 20);
    await within.startTreeBuild.execute("photosynthesis");
    expect(within.logs.map((entry) => entry.msg)).toContain("build estimate");
    expect(within.logs.some((entry) => entry.level === "warn")).toBe(false);

    // No LLM_DAILY_REQUEST_BUDGET set: nothing to compare against, so nothing to warn about.
    const unknown = setup(ok);
    await unknown.startTreeBuild.execute("photosynthesis");
    expect(unknown.logs.some((entry) => entry.level === "warn")).toBe(false);
  });

  it("fails before creating a run when the daily quota is gone", async () => {
    const { queue, runRepo, startTreeBuild } = setup(async () => {
      throw new QuotaExhaustedError("gemini-3.6-flash");
    });
    await expect(startTreeBuild.execute("photosynthesis")).rejects.toThrow(QuotaExhaustedError);
    // Nothing to clean up: no run row, no orphaned message.
    expect(await runRepo.get(runId)).toBeUndefined();
    expect(queue.size()).toBe(0);
  });

  describe("concurrency guard", () => {
    // A second builder over the same repository, so the guard sees the first run's real status rather
    // than a counter this test kept for it.
    function second(runRepo: ReturnType<typeof createMemoryRunRepository>, limit?: number) {
      let calls = 0;
      const build = createStartTreeBuild({
        parser: {
          parse: async (raw: string) => {
            calls += 1;
            return { topic: raw, maxDepth: 1 };
          },
        },
        ids: { next: () => "22222222-2222-4222-8222-222222222222" },
        runRepo,
        queue: createMemoryNodeQueue(),
        logger: fakeLogger().logger,
        maxConcurrentRuns: limit,
      });
      return { build, parserCalls: () => calls };
    }

    it("refuses a second run while one is constructing, without spending an LLM call", async () => {
      const { runRepo, startTreeBuild } = setup(ok, undefined, 1);
      await startTreeBuild.execute("photosynthesis");

      const { build, parserCalls } = second(runRepo, 1);
      await expect(build.execute("black holes")).rejects.toBeInstanceOf(RunInProgressError);
      // The whole point of the guard is saving quota, so rejecting must not cost a parser request.
      expect(parserCalls()).toBe(0);
    });

    it("lets the next run start once the first leaves constructing", async () => {
      const { runRepo, startTreeBuild } = setup(ok, undefined, 1);
      await startTreeBuild.execute("photosynthesis");
      await runRepo.setStatus(runId, "constructed");

      const { build, parserCalls } = second(runRepo, 1);
      await expect(build.execute("black holes")).resolves.toMatchObject({ runId: expect.any(String) });
      expect(parserCalls()).toBe(1);
    });

    it("does not guard at all when no limit is configured", async () => {
      const { runRepo, startTreeBuild } = setup(ok);
      await startTreeBuild.execute("photosynthesis");

      const { build } = second(runRepo);
      await expect(build.execute("black holes")).resolves.toBeDefined();
    });
  });
});

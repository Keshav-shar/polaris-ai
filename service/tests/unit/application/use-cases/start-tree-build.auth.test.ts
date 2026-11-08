import { describe, expect, it } from "vitest";
import {
  createStartTreeBuild,
  msUntilUtcMidnight,
} from "../../../../src/application/use-cases/start-tree-build.use-case";
import { RunInProgressError } from "../../../../src/domain/errors/run-in-progress.error";
import { UnauthenticatedError } from "../../../../src/domain/errors/unauthenticated.error";
import { UserQuotaExhaustedError } from "../../../../src/domain/errors/user-quota-exhausted.error";
import { createMemoryNodeQueue } from "../../../../src/infrastructure/memory/memory-node-queue.adapter";
import { createMemoryRunRepository } from "../../../../src/infrastructure/memory/memory-run.repository";
import { createMemoryUsageStore } from "../../../../src/infrastructure/memory/memory-usage.store";
import { fakeLogger } from "../../../fixtures/fake-generate";

const caller = { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
let next = 0;
const ids = { next: () => `00000000-0000-4000-8000-${String((next += 1)).padStart(12, "0")}` };

function setup({ maxRunsPerDay = 2, maxStoredRuns = 3, maxConcurrentRuns }: {
  maxRunsPerDay?: number;
  maxStoredRuns?: number;
  maxConcurrentRuns?: number;
} = {}) {
  const runRepo = createMemoryRunRepository();
  const queue = createMemoryNodeQueue();
  const usage = createMemoryUsageStore({ now: () => Date.UTC(2026, 10, 1, 12) });
  const startTreeBuild = createStartTreeBuild({
    ids,
    runRepo,
    queue,
    logger: fakeLogger().logger,
    maxConcurrentRuns,
    users: { usage, maxRunsPerDay, maxStoredRuns, now: () => Date.UTC(2026, 10, 1, 12) },
  });
  return { runRepo, queue, usage, startTreeBuild };
}

describe("start-tree-build with auth on (C105)", () => {
  it("refuses an anonymous build before any work", async () => {
    const { queue, startTreeBuild } = setup();
    await expect(startTreeBuild.execute("photosynthesis")).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(queue.size()).toBe(0);
  });

  it("stores the run as the caller's, private, with the request kept for them", async () => {
    const { runRepo, startTreeBuild } = setup();
    const { runId } = await startTreeBuild.execute("teach me photosynthesis", { caller });
    expect(await runRepo.get(runId)).toMatchObject({
      ownerId: caller.userId,
      visibility: "private",
      request: "teach me photosynthesis",
    });
  });

  it("refuses the build over the daily cap with a wait until UTC midnight", async () => {
    const { startTreeBuild } = setup({ maxRunsPerDay: 1 });
    await startTreeBuild.execute("one", { caller });
    const refused = await startTreeBuild.execute("two", { caller }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(UserQuotaExhaustedError);
    expect((refused as UserQuotaExhaustedError).retryAfterMs).toBe(12 * 3600 * 1000);
  });

  it("never spends a daily build on a request refused for another reason", async () => {
    const busy = setup({ maxRunsPerDay: 1, maxConcurrentRuns: 0 });
    await expect(busy.startTreeBuild.execute("x", { caller })).rejects.toBeInstanceOf(RunInProgressError);
    expect(await busy.usage.reserveRun(caller.userId, 1)).toBe(true);

    const idle = setup({ maxRunsPerDay: 1 });
    await expect(idle.startTreeBuild.execute("x", { caller, maxDepth: 99 })).rejects.toBeInstanceOf(RangeError);
    // Neither refusal spent the caller's single build for today.
    expect(await idle.usage.reserveRun(caller.userId, 1)).toBe(true);
  });

  it("prunes the oldest private finished maps to make room, and says so", async () => {
    const { runRepo, startTreeBuild } = setup({ maxRunsPerDay: 10, maxStoredRuns: 2 });
    const first = await startTreeBuild.execute("one", { caller });
    await runRepo.setStatus(first.runId, "done");
    const second = await startTreeBuild.execute("two", { caller });
    await runRepo.setStatus(second.runId, "done");

    const third = await startTreeBuild.execute("three", { caller });
    expect(third.prunedRuns).toBe(1);
    expect(await runRepo.get(first.runId)).toBeUndefined();
    expect(await runRepo.get(second.runId)).toBeDefined();
  });
});

describe("msUntilUtcMidnight", () => {
  it("counts to the next UTC day", () => {
    expect(msUntilUtcMidnight(Date.UTC(2026, 10, 1, 23, 59, 59))).toBe(1000);
  });
});

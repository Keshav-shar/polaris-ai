import { describe, expect, it } from "vitest";
import { createHaltRun } from "../../../../src/application/use-cases/halt-run.use-case";
import { QuotaExhaustedError } from "../../../../src/domain/errors/quota-exhausted.error";
import { createMemoryRunRepository } from "../../../../src/infrastructure/memory/memory-run.repository";
import { fakeLogger } from "../../../fixtures/fake-generate";

const runId = "11111111-1111-4111-8111-111111111111";

async function setup() {
  const runRepo = createMemoryRunRepository();
  const { logger, logs } = fakeLogger();
  await runRepo.create({ runId, topic: "photosynthesis", maxDepth: 2, status: "constructing" });
  return { runRepo, logs, haltRun: createHaltRun({ runRepo, logger }) };
}

describe("halt-run use-case", () => {
  it("marks the run halted and records a readable reason", async () => {
    const { runRepo, haltRun } = await setup();
    await haltRun.execute(runId, new QuotaExhaustedError("gemini-3.6-flash"));

    const run = await runRepo.get(runId);
    // Leaving it `constructing` would tell the UI to poll for a tree that never arrives (C55).
    expect(run?.status).toBe("halted");
    expect(run?.haltReason).toMatch(/daily quota exhausted for model "gemini-3\.6-flash"/);
  });

  it("keeps the reason readable for a non-Error value", async () => {
    const { runRepo, haltRun } = await setup();
    await haltRun.execute(runId, "provider went away");
    expect(await runRepo.get(runId)).toMatchObject({ status: "halted", haltReason: "provider went away" });
  });

  it("logs the halt against its run", async () => {
    const { logs, haltRun } = await setup();
    await haltRun.execute(runId, new QuotaExhaustedError("m"));
    const entry = logs.find((l) => l.msg === "run halted");
    expect(entry?.level).toBe("error");
    expect(entry?.context).toMatchObject({ runId });
  });
});

import { describe, expect, it } from "vitest";
import { createMemoryRunRepository } from "../../../../src/infrastructure/memory/memory-run.repository";
import type { Run } from "../../../../src/domain/schemas/run.schema";

const run = (runId: string, status: Run["status"] = "constructing"): Run => ({
  runId,
  topic: "photosynthesis",
  maxDepth: 2,
  status,
});

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";

describe("memory run repository", () => {
  it("stores a copy, so a caller cannot mutate the record it was given", async () => {
    const repo = createMemoryRunRepository();
    const original = run(a);
    await repo.create(original);
    original.status = "failed";
    expect((await repo.get(a))?.status).toBe("constructing");
  });

  // C100: kickoff stores a provisional topic; the root's own call names the canonical one.
  it("replaces the provisional topic with the canonical one, and ignores an unknown run", async () => {
    const repo = createMemoryRunRepository();
    await repo.create({ ...run(a), topic: "teach me photosynthesis please" });
    await repo.setTopic(a, "Photosynthesis");
    await repo.setTopic(b, "Nothing");
    expect((await repo.get(a))?.topic).toBe("Photosynthesis");
    expect(await repo.get(b)).toBeUndefined();
  });

  it("records a halt reason alongside the status", async () => {
    const repo = createMemoryRunRepository();
    await repo.create(run(a));
    await repo.setStatus(a, "halted", "LLM daily quota exhausted");
    expect(await repo.get(a)).toMatchObject({ status: "halted", haltReason: "LLM daily quota exhausted" });
  });

  it("counts only the runs that are still constructing", async () => {
    const repo = createMemoryRunRepository();
    expect(await repo.countActive()).toBe(0);

    await repo.create(run(a));
    await repo.create(run(b));
    expect(await repo.countActive()).toBe(2);

    // Every terminal status frees a slot: a halted run is not going to resume in this process, and the
    // cost guard must not leave the API refusing builds forever because of one (docs/conflicts.md C61).
    await repo.setStatus(a, "halted", "quota");
    expect(await repo.countActive()).toBe(1);
    await repo.setStatus(b, "constructed");
    expect(await repo.countActive()).toBe(0);
  });

  it("ignores a status change for an unknown run", async () => {
    const repo = createMemoryRunRepository();
    await expect(repo.setStatus(a, "failed")).resolves.toBeUndefined();
    expect(await repo.get(a)).toBeUndefined();
  });
});

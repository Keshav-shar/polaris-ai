import { describe, expect, it } from "vitest";
import { createListRuns } from "../../../../src/application/use-cases/list-runs.use-case";
import { RUNS_LIST_LIMIT } from "../../../../src/config/constants";
import { RunsResponse } from "../../../../src/domain/schemas/api.schema";
import type { Run } from "../../../../src/domain/schemas/run.schema";
import { createMemoryRunRepository } from "../../../../src/infrastructure/memory/memory-run.repository";

function run(topic: string, overrides: Partial<Run> = {}): Run {
  return {
    runId: crypto.randomUUID(),
    topic,
    maxDepth: 2,
    status: "constructed",
    ...overrides,
  };
}

describe("createListRuns", () => {
  it("returns the newest run first, which is the order the Codex shows", async () => {
    const runs = createMemoryRunRepository();
    await runs.create(run("oldest"));
    await runs.create(run("middle"));
    await runs.create(run("newest"));

    const result = await createListRuns({ runs }).execute(RUNS_LIST_LIMIT);
    expect(result.runs.map((r) => r.topic)).toEqual(["newest", "middle", "oldest"]);
  });

  it("never returns more than the limit it was given", async () => {
    const runs = createMemoryRunRepository();
    for (let i = 0; i < 5; i++) await runs.create(run(`run-${i}`));
    expect((await createListRuns({ runs }).execute(2)).runs).toHaveLength(2);
  });

  it("returns an empty list rather than failing when no run exists yet", async () => {
    // In-memory runs vanish on restart, so an empty Codex is the normal first state, not an error.
    const result = await createListRuns({ runs: createMemoryRunRepository() }).execute(RUNS_LIST_LIMIT);
    expect(result.runs).toEqual([]);
  });

  it("carries haltReason through only when the run actually has one", async () => {
    const runs = createMemoryRunRepository();
    await runs.create(run("fine"));
    await runs.create(run("stalled", { status: "halted", haltReason: "daily quota exhausted" }));

    const [stalled, fine] = (await createListRuns({ runs }).execute(RUNS_LIST_LIMIT)).runs;
    expect(stalled?.haltReason).toBe("daily quota exhausted");
    // Absent, not an explicit undefined: the field is optional in the response schema.
    expect(fine && "haltReason" in fine).toBe(false);
  });

  it("produces a body that satisfies the published response schema", async () => {
    const runs = createMemoryRunRepository();
    await runs.create(run("photosynthesis"));
    const result = await createListRuns({ runs }).execute(RUNS_LIST_LIMIT);
    expect(() => RunsResponse.parse(result)).not.toThrow();
  });

  it("hands back copies, so a caller cannot mutate the repository through the list", async () => {
    const runs = createMemoryRunRepository();
    const original = run("photosynthesis");
    await runs.create(original);

    const result = await createListRuns({ runs }).execute(RUNS_LIST_LIMIT);
    result.runs[0]!.topic = "tampered";
    expect((await runs.get(original.runId))?.topic).toBe("photosynthesis");
  });
});

import { describe, expect, it } from "vitest";
import { probeSchema } from "../../../../src/infrastructure/postgres/schema-probe";
import type { Db } from "../../../../src/infrastructure/postgres/supabase.client";
import { DependencyUnavailableError } from "../../../../src/domain/errors/dependency-unavailable.error";

type Answer = { error: { message: string; code?: string } | null };

// A stand-in for supabase-js's `from(table).select(cols).limit(0)`, answering per "table" or "table.column".
function fakeDb(answer: (table: string, columns: string) => Answer): Db {
  return {
    from: (table: string) => ({
      select: (columns: string) => ({ limit: async () => answer(table, columns) }),
    }),
  } as unknown as Db;
}

describe("probeSchema (C143)", () => {
  it("reports nothing for a complete schema", async () => {
    await expect(probeSchema(fakeDb(() => ({ error: null })))).resolves.toEqual([]);
  });

  it("names the missing tables AND the missing late column - the half-pushed state seen live", async () => {
    const db = fakeDb((table, columns) => {
      if (table === "lesson_feedback" || table === "learner_insights") return { error: { message: "not found", code: "PGRST205" } };
      if (columns === "insights_generated") return { error: { message: "column does not exist", code: "42703" } };
      return { error: null };
    });
    await expect(probeSchema(db)).resolves.toEqual([
      "lesson_feedback (0013)",
      "learner_insights (0014)",
      "usage_daily.insights_generated (0015)",
    ]);
  });

  it("throws an outage instead of calling it a missing schema", async () => {
    const db = fakeDb(() => ({ error: { message: "TypeError: fetch failed", code: "" } }));
    await expect(probeSchema(db)).rejects.toBeInstanceOf(DependencyUnavailableError);
  });
});

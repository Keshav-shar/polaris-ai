import { describe, expect, it } from "vitest";
import { createPostgresEvidenceRepository } from "../../../../src/infrastructure/postgres/evidence.repository";
import type { Db } from "../../../../src/infrastructure/postgres/supabase.client";

const nodeId = "22222222-2222-4222-8222-222222222222";
const base = {
  url: "https://doi.org/10.1017/x",
  title: "t",
  snippet: "s",
  credibility: 0.9,
  retrieval_query: "q",
  retrieved_at: "2026-11-08 00:00:00+00",
};

function fakeDb(rows: unknown[]) {
  const calls: { rpc?: unknown; select?: string } = {};
  const db = {
    rpc: async (_name: string, args: unknown) => {
      calls.rpc = args;
      return { data: null, error: null };
    },
    from: () => ({
      select: (columns: string) => {
        calls.select = columns;
        return { eq: () => ({ order: async () => ({ data: rows, error: null }) }) };
      },
    }),
  } as unknown as Db;
  return { db, calls };
}

// C146: the provider column (0017) round-trips, and reading never depends on it existing.
describe("createPostgresEvidenceRepository", () => {
  it("sends each record's provider, or null for one without", async () => {
    const { db, calls } = fakeDb([]);
    const record = { nodeId, url: base.url, title: "t", snippet: "s", credibility: 0.9, retrievalQuery: "q", retrievedAt: "2026-11-08T00:00:00.000Z" };
    await createPostgresEvidenceRepository(db).replaceForNode(nodeId, [{ ...record, provider: "crossref" }, record]);
    const rows = (calls.rpc as { p_rows: { provider: unknown }[] }).p_rows;
    expect(rows.map((row) => row.provider)).toEqual(["crossref", null]);
  });

  it("reads rows from before 0017 (no column), with a null provider, and with an unknown one", async () => {
    const { db, calls } = fakeDb([base, { ...base, provider: null }, { ...base, provider: "gdelt" }, { ...base, provider: "scholar" }]);
    const records = await createPostgresEvidenceRepository(db).listForNode(nodeId);
    expect(calls.select).toBe("*");
    expect(records.map((record) => record.provider)).toEqual([undefined, undefined, "gdelt", undefined]);
  });
});

import { z } from "zod";
import type { EvidenceRepositoryPort } from "../../application/ports/evidence-repository.port";
import { EvidenceRecord, SourceProvider } from "../../domain/schemas/evidence.schema";
import { check } from "./postgres-error";
import type { Db } from "./supabase.client";

const EvidenceRow = z.object({
  url: z.string(),
  title: z.string(),
  snippet: z.string(),
  // PostgREST sends numeric as a JSON number, but a string is accepted rather than trusted to never happen.
  credibility: z.coerce.number(),
  retrieval_query: z.string(),
  retrieved_at: z.string(),
  // 0017 (C146). Absent before that migration and null on older rows; an unknown value is read as unset.
  provider: SourceProvider.nullish().catch(undefined),
});

// Every source the writer was shown, in retrieval order (C79, C123). Replaced in one transaction, never appended.
export function createPostgresEvidenceRepository(db: Db): EvidenceRepositoryPort {
  return {
    async replaceForNode(nodeId, records) {
      check(
        "evidence.replaceForNode",
        await db.rpc("replace_evidence", {
          p_node_id: nodeId,
          p_rows: records.map((record, position) => ({
            position,
            url: record.url,
            title: record.title,
            snippet: record.snippet,
            credibility: record.credibility,
            retrieval_query: record.retrievalQuery,
            retrieved_at: record.retrievedAt,
            provider: record.provider ?? null,
          })),
        }),
      );
    },

    async listForNode(nodeId) {
      const result = await db
        .from("evidence")
        // "*" rather than a column list, so a database still waiting for 0017 keeps serving evidence (C143).
        .select("*")
        .eq("node_id", nodeId)
        .order("position", { ascending: true });
      check("evidence.listForNode", result);
      return (result.data ?? []).map((raw) => {
        const row = EvidenceRow.parse(raw);
        return EvidenceRecord.parse({
          nodeId,
          url: row.url,
          title: row.title,
          snippet: row.snippet,
          credibility: row.credibility,
          retrievalQuery: row.retrieval_query,
          // timestamptz comes back in Postgres's own format; the record carries ISO 8601, as retrieval wrote it.
          retrievedAt: new Date(row.retrieved_at).toISOString(),
          ...(row.provider ? { provider: row.provider } : {}),
        });
      });
    },
  };
}

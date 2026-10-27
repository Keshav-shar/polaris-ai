import type { EvidenceRecord } from "../../domain/schemas/evidence.schema";

// The permanent evidence store: in memory now, Postgres `evidence` from Phase 12. It answers "why does this
// node say this" - every source the writer was shown, with the query that found it and when (C79, C123).
export type EvidenceRepositoryPort = {
  // Rule 6: REPLACES the node's evidence in one write, so a redelivered article that searched again leaves
  // exactly one set - never the union of two attempts.
  replaceForNode(nodeId: string, records: readonly EvidenceRecord[]): Promise<void>;
  listForNode(nodeId: string): Promise<EvidenceRecord[]>;
};

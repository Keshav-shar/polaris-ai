import type { EvidenceRepositoryPort } from "../../application/ports/evidence-repository.port";
import { EvidenceRecord } from "../../domain/schemas/evidence.schema";

export function createMemoryEvidenceRepository(): EvidenceRepositoryPort {
  const byNode = new Map<string, EvidenceRecord[]>();

  return {
    async replaceForNode(nodeId, records) {
      // Validated on the way in, like any row crossing into a store: a record for another node, or one
      // missing its provenance, is a caller bug that must not be stored silently.
      const parsed = records.map((record) => EvidenceRecord.parse(record));
      if (parsed.some((record) => record.nodeId !== nodeId)) {
        throw new Error(`replaceForNode: every record must belong to node ${nodeId}`);
      }
      byNode.set(nodeId, parsed);
    },
    async listForNode(nodeId) {
      return (byNode.get(nodeId) ?? []).map((record) => ({ ...record }));
    },
  };
}

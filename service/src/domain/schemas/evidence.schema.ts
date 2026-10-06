import { z } from "zod";
import { HttpUrl } from "./url.schema";

export const EvidenceItem = z.object({
  url: HttpUrl,
  title: z.string(),
  snippet: z.string(),
  credibility: z.number().min(0).max(1),
});
export type EvidenceItem = z.infer<typeof EvidenceItem>;

// The STORED shape. Kept separate from EvidenceItem on purpose: EvidenceItem is what goes into the
// writer's prompt through ArticleContext, so provenance fields bolted onto it would reach the model as
// noise. docs/data-model.md asks evidence rows to answer "why does this node say this", and only the
// retrieval agent knows the query - it used to compute it and throw it away, which meant no Phase 12
// adapter could ever populate `retrieval_query` (docs/conflicts.md C79).
export const EvidenceRecord = EvidenceItem.extend({
  nodeId: z.uuid(),
  retrievalQuery: z.string().min(1),
  // ISO 8601, from an injected clock - the domain never reads the ambient time.
  retrievedAt: z.string().min(1),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecord>;

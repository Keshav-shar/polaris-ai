import { z } from "zod";
import { HttpUrl } from "./url.schema";

// Which search provider found a source (C146). Recorded so the writer can compare sources of different kinds and
// so a stored citation says where it came from. Reuters / AP arrive through GDELT; Cambridge, Oxford and IEEE
// through Crossref (and IEEE Xplore when keyed); OpenAlex stands in for Google Scholar, which has no API.
export const SourceProvider = z.enum(["wikipedia", "tavily", "crossref", "openalex", "ieee", "gdelt"]);
export type SourceProvider = z.infer<typeof SourceProvider>;

export type SourceKind = "reference" | "scholarly" | "news";

// Pure: what kind of text a provider returns. A news item is a HEADLINE (GDELT returns no body), which the
// writer prompt treats as current context only, never as a source for a mechanism or definition.
export function sourceKind(provider: SourceProvider | undefined): SourceKind {
  switch (provider) {
    case "crossref":
    case "openalex":
    case "ieee":
      return "scholarly";
    case "gdelt":
      return "news";
    default:
      return "reference";
  }
}

export const EvidenceItem = z.object({
  url: HttpUrl,
  title: z.string(),
  snippet: z.string(),
  credibility: z.number().min(0).max(1),
  // Optional: evidence stored before C146 has no provider, and must still parse.
  provider: SourceProvider.optional(),
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

import type { SourceProvider } from "../../domain/schemas/evidence.schema";

// Web search for the article pass's retrieval agent. Construction never calls it (docs/conflicts.md C05).
//
// Results are RAW: no credibility field. Scoring is a pure domain rule
// (domain/credibility/credibility-scorer.ts), so an adapter cannot quietly decide what counts as credible.
export type SearchResult = {
  url: string;
  title: string;
  // Plain text. Adapters strip provider markup (MediaWiki returns `<span class="searchmatch">`, Crossref JATS)
  // so no consumer has to know which provider answered.
  snippet: string;
  // Which provider found it (C146): the scorer's base for a DOI link, and the writer's "kind" of source.
  provider: SourceProvider;
};

export type SearchPort = {
  // Returns at most `maxResults`, best first. A provider failure throws; an empty result set is not a
  // failure - a node with no sources still gets an article, marked unverified.
  search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]>;
};

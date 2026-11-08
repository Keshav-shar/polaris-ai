import type { SearchPort, SearchResult } from "../../application/ports/search.port";
import { RETRIEVAL } from "../../config/constants";
import { TransportUnavailableError } from "../../domain/errors/transport-unavailable.error";
import type { SourceProvider } from "../../domain/schemas/evidence.schema";
import type { Logger } from "../../shared/logger";

export type ProviderSearch = { provider: SourceProvider; port: SearchPort };

export type MultiSourceConfig = {
  providers: readonly ProviderSearch[];
  logger: Pick<Logger, "warn">;
  // At most this many results from one provider while another still has some to give (C146).
  perProvider?: number;
};

// One identity per WORK: a DOI is the same work whichever index returned it (Crossref, OpenAlex and IEEE all
// carry IEEE papers), otherwise origin + path + query with the trailing slash and the fragment dropped.
export function workKey(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "doi.org" || parsed.hostname === "dx.doi.org") {
      return `doi:${decodeURIComponent(parsed.pathname.slice(1)).toLowerCase()}`;
    }
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

// Pure merge: round-robin by rank across providers (every provider's best result before anyone's second), at most
// `perProvider` from one provider; then, only if slots are still free because the others ran dry, the overflow in
// the same order. Breadth first, and a single-provider setup still gets a full set.
export function mergeRoundRobin(
  lists: readonly (readonly SearchResult[])[],
  maxResults: number,
  perProvider: number,
): SearchResult[] {
  const seen = new Set<string>();
  const merged: SearchResult[] = [];
  const overflow: SearchResult[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let rank = 0; rank < longest; rank++) {
    for (const list of lists) {
      const result = list[rank];
      if (result === undefined) continue;
      const key = workKey(result.url);
      if (seen.has(key)) continue;
      seen.add(key);
      (rank < perProvider ? merged : overflow).push(result);
    }
  }
  return [...merged, ...overflow].slice(0, maxResults);
}

// Every configured provider searched in PARALLEL for one lesson - the "first search" whose citations the writer
// uses and compares (C146). A provider that fails is logged and left out; the lesson goes ahead on the rest.
//
// Stall rule (C94, C115): if nothing at all came back AND at least one provider could not be reached, the whole
// search is a stall, so the article is retried later uncounted instead of being written from no sources. If
// nothing came back because every provider answered with an error, it is an ordinary failure.
export function createMultiSourceSearch({
  providers,
  logger,
  perProvider = RETRIEVAL.PER_PROVIDER,
}: MultiSourceConfig): SearchPort {
  if (providers.length === 0) throw new RangeError("createMultiSourceSearch needs at least one provider");
  return {
    async search(query, maxResults, signal) {
      const settled = await Promise.allSettled(providers.map(({ port }) => port.search(query, maxResults, signal)));
      const lists: SearchResult[][] = [];
      const failures: { provider: SourceProvider; error: unknown }[] = [];
      settled.forEach((outcome, i) => {
        const provider = providers[i]!.provider;
        if (outcome.status === "fulfilled") lists.push(outcome.value);
        else failures.push({ provider, error: outcome.reason });
      });
      if (signal?.aborted) throw signal.reason;

      for (const { provider, error } of failures) {
        // The message only: adapter errors name the provider and a status, never a URL (which can carry a key).
        logger.warn("search provider skipped", {
          provider,
          reason: error instanceof Error ? error.message : String(error),
        });
      }

      const merged = mergeRoundRobin(lists, maxResults, perProvider);
      if (merged.length === 0 && failures.length > 0) {
        const stalled = failures.find(({ error }) => error instanceof TransportUnavailableError);
        if (stalled !== undefined) throw stalled.error;
        if (lists.length === 0) {
          throw new Error(`every search provider failed: ${failures.map((f) => f.provider).join(", ")}`);
        }
      }
      return merged;
    },
  };
}

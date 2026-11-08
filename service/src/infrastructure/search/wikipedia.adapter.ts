import { z } from "zod";
import type { SearchPort, SearchResult } from "../../application/ports/search.port";
import { SEARCH } from "../../config/constants";
import { capText, type FetchLike, stripHtml, withStallOnTransportFault } from "./search-http";

export type WikipediaConfig = {
  // Wikipedia asks API clients to identify themselves; requests without a UA are rate-limited harder.
  userAgent: string;
  // Overridable so a test can point at a fixture server, and so a non-English wiki stays possible.
  apiUrl?: string;
  timeoutMs?: number;
};

// The slice of the MediaWiki response we rely on: `generator=search` + `prop=extracts`, formatversion 2.
// Recorded live 2026-10-07: `query.pages` is an ARRAY in no particular order, each page carrying its search
// rank as `index`, its `title` and a plain-text intro `extract` (500-2,200 chars seen). Parsed, not cast: it
// crosses a trust boundary; a page that does not parse is skipped rather than failing the whole search.
const Page = z.object({
  pageid: z.number().int(),
  title: z.string(),
  index: z.number().int().optional().catch(undefined),
  extract: z.string().optional().catch(undefined),
});
const SearchResponse = z.object({
  query: z
    .object({ pages: z.array(z.unknown()).optional().catch(undefined) })
    .optional()
    .catch(undefined),
});

export function createWikipediaSearch(config: WikipediaConfig, fetchImpl: FetchLike = fetch): SearchPort {
  const apiUrl = config.apiUrl ?? SEARCH.WIKIPEDIA_API_URL;
  const timeoutMs = config.timeoutMs ?? SEARCH.TIMEOUT_MS;

  return {
    async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
      // ONE call that searches AND returns each hit's plain-text intro (C122). A search snippet is ~40 tokens
      // of keyword context - too little for a claim to be checked against, so groundedness (C124) needs the
      // page text itself. Still one HTTP call per node.
      const url = new URL(apiUrl);
      url.searchParams.set("action", "query");
      url.searchParams.set("format", "json");
      url.searchParams.set("formatversion", "2");
      url.searchParams.set("origin", "*");
      url.searchParams.set("generator", "search");
      url.searchParams.set("gsrsearch", query);
      url.searchParams.set("gsrlimit", String(Math.max(1, maxResults)));
      url.searchParams.set("prop", "extracts");
      url.searchParams.set("exintro", "1");
      url.searchParams.set("explaintext", "1");
      url.searchParams.set("exlimit", "max");

      // Our own timeout, plus the caller's cancellation if it gave one: a hung search must not hold a
      // node's article hostage for the whole Lambda timeout.
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);

      const body = await withStallOnTransportFault("wikipedia", signal, async () => {
        const response = await fetchImpl(url.toString(), {
          headers: { "User-Agent": config.userAgent, Accept: "application/json" },
          signal: combined,
        });
        if (!response.ok) {
          throw new Error(`Wikipedia search failed with HTTP ${response.status}`);
        }
        return (await response.json()) as unknown;
      });

      const parsed = SearchResponse.safeParse(body);
      // A shape we cannot read is an empty result set, not a crash: the node still gets an unverified
      // article rather than failing the whole run over a search.
      const pages = (parsed.success ? (parsed.data.query?.pages ?? []) : []).flatMap((raw) => {
        const page = Page.safeParse(raw);
        return page.success ? [page.data] : [];
      });

      return (
        pages
          // Search rank, not array order: the API returns pages unordered.
          .sort((a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER))
          .map((page) => ({
            // `?curid=` is the canonical, rename-proof permalink: a page retitled tomorrow keeps this URL,
            // which matters because citations are stored and read back much later.
            url: `${SEARCH.WIKIPEDIA_PAGE_URL}?curid=${page.pageid}`,
            title: capText(stripHtml(page.title), SEARCH.TITLE_MAX_CHARS),
            // Plain text already (explaintext), but untrusted all the same: stripped and bounded (C103).
            snippet: capText(stripHtml(page.extract ?? ""), SEARCH.SNIPPET_MAX_CHARS),
            provider: "wikipedia" as const,
          }))
          // A page with no text gives a claim nothing to be checked against, so it is not evidence.
          .filter((result) => result.snippet !== "")
          .slice(0, maxResults)
      );
    },
  };
}

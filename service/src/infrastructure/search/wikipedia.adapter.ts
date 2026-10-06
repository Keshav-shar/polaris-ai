import { z } from "zod";
import type { SearchPort, SearchResult } from "../../application/ports/search.port";
import { SEARCH } from "../../config/constants";

export type WikipediaConfig = {
  // Wikipedia asks API clients to identify themselves; requests without a UA are rate-limited harder.
  userAgent: string;
  // Overridable so a test can point at a fixture server, and so a non-English wiki stays possible.
  apiUrl?: string;
  timeoutMs?: number;
};

// The slice of the MediaWiki response we rely on. Parsed, not cast: it crosses a trust boundary.
const SearchResponse = z.object({
  query: z
    .object({
      search: z
        .array(
          z.object({
            pageid: z.number().int(),
            title: z.string(),
            snippet: z.string().optional().catch(undefined),
          }),
        )
        .optional()
        .catch(undefined),
    })
    .optional()
    .catch(undefined),
});

// MediaWiki marks matches with `<span class="searchmatch">` and encodes entities. Snippets are quoted into
// a prompt as source text, so any markup left here would reach the model as noise - and tags a model might
// read as instructions have no business in evidence (agents-and-prompts.md: snippets are data, not
// instructions).
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function createWikipediaSearch(config: WikipediaConfig, fetchImpl: FetchLike = fetch): SearchPort {
  const apiUrl = config.apiUrl ?? SEARCH.WIKIPEDIA_API_URL;
  const timeoutMs = config.timeoutMs ?? SEARCH.TIMEOUT_MS;

  return {
    async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
      const url = new URL(apiUrl);
      url.searchParams.set("action", "query");
      url.searchParams.set("list", "search");
      url.searchParams.set("format", "json");
      url.searchParams.set("origin", "*");
      url.searchParams.set("srsearch", query);
      url.searchParams.set("srlimit", String(Math.max(1, maxResults)));

      // Our own timeout, plus the caller's cancellation if it gave one: a hung search must not hold a
      // node's article hostage for the whole Lambda timeout.
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);

      const response = await fetchImpl(url.toString(), {
        headers: { "User-Agent": config.userAgent, Accept: "application/json" },
        signal: combined,
      });
      if (!response.ok) {
        throw new Error(`Wikipedia search failed with HTTP ${response.status}`);
      }

      const parsed = SearchResponse.safeParse(await response.json());
      // A shape we cannot read is an empty result set, not a crash: the node still gets an unverified
      // article rather than failing the whole run over a search.
      const hits = parsed.success ? (parsed.data.query?.search ?? []) : [];

      return hits.slice(0, maxResults).map((hit) => ({
        // `?curid=` is the canonical, rename-proof permalink: a page retitled tomorrow keeps this URL,
        // which matters because citations are stored and read back much later.
        url: `${SEARCH.WIKIPEDIA_PAGE_URL}?curid=${hit.pageid}`,
        title: hit.title,
        snippet: stripHtml(hit.snippet ?? ""),
      }));
    },
  };
}

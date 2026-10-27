import { z } from "zod";
import type { SearchPort, SearchResult } from "../../application/ports/search.port";
import { SEARCH } from "../../config/constants";
import { TransportUnavailableError } from "../../domain/errors/transport-unavailable.error";
import { transportFaultCode } from "../../shared/transport-fault";

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

// MediaWiki marks matches with `<span class="searchmatch">` and encodes entities. Snippets are quoted into
// a prompt as source text, so any markup left here would reach the model as noise - and tags a model might
// read as instructions have no business in evidence (agents-and-prompts.md: snippets are data, not
// instructions).
//
// Tags are stripped BEFORE entities are decoded, so an encoded `&lt;b&gt;` in an article about HTML survives
// as the literal text "<b>" - which is what the page says. That text is still untrusted: what stops it
// closing the prompt's <sources> block is dataBlock, which strips every variant of its own tag (C103).
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

// Search text is untrusted and quoted straight into the writer prompt, so its size is bounded here (C103).
export function capText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

// A search that never completed - DNS, socket, our own timeout, including one that fires while the body is
// still arriving - is raised as a STALL, exactly as the LLM adapter raises one, so the article worker
// releases the message uncounted and with a delay instead of spending one of the node's receives on a
// network blip (docs/conflicts.md C94, C115). A response with a status, even a 5xx, is the provider
// answering and stays an ordinary error. A caller that aborted on purpose gets its abort back unchanged.
export async function withStallOnTransportFault<T>(
  provider: string,
  callerSignal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (callerSignal?.aborted) throw error;
    const fault = transportFaultCode(error);
    if (fault === undefined) throw error;
    throw new TransportUnavailableError(`the search provider (${provider})`, fault);
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

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
          }))
          // A page with no text gives a claim nothing to be checked against, so it is not evidence.
          .filter((result) => result.snippet !== "")
          .slice(0, maxResults)
      );
    },
  };
}

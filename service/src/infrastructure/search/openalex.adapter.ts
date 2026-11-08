import { z } from "zod";
import type { SearchPort, SearchResult } from "../../application/ports/search.port";
import { SEARCH } from "../../config/constants";
import { cleanSnippet, cleanTitle, type FetchLike, getJson } from "./search-http";

export type OpenAlexConfig = {
  // Required for production use since 2026-02-13; the free key's daily budget is the quota (free-tier-constraints.md).
  apiKey: string;
  userAgent: string;
  contactEmail?: string;
  apiUrl?: string;
  timeoutMs?: number;
};

const Work = z.object({
  id: z.string(),
  doi: z.string().nullable().optional().catch(undefined),
  display_name: z.string().nullable().optional().catch(undefined),
  abstract_inverted_index: z.record(z.string(), z.array(z.number().int().min(0))).nullable().optional().catch(undefined),
  primary_location: z
    .object({ landing_page_url: z.string().nullable().optional().catch(undefined) })
    .nullable()
    .optional()
    .catch(undefined),
});
const Response = z.object({ results: z.array(z.unknown()).optional().catch(undefined) });

// OpenAlex ships abstracts as an inverted index (word -> positions) for licensing reasons; this puts the words
// back in order. Positions are bounded so a hostile index cannot make us allocate an enormous array.
export function abstractFromInvertedIndex(index: Record<string, number[]> | null | undefined, maxWords = 400): string {
  if (index === null || index === undefined) return "";
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) {
      if (position < maxWords) words[position] = word;
    }
  }
  return words.filter((word) => word !== undefined).join(" ");
}

// The stand-in for Google Scholar (which has no API and forbids scraping, C146): 250M+ scholarly works across
// publishers, with retracted works filtered out and only works that HAVE an abstract asked for.
export function createOpenAlexSearch(config: OpenAlexConfig, fetchImpl: FetchLike = fetch): SearchPort {
  const apiUrl = config.apiUrl ?? SEARCH.OPENALEX_API_URL;
  const timeoutMs = config.timeoutMs ?? SEARCH.TIMEOUT_MS;

  return {
    async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
      const url = new URL(apiUrl);
      url.searchParams.set("search", query);
      url.searchParams.set("filter", "has_abstract:true,is_retracted:false");
      url.searchParams.set("per-page", String(Math.max(1, maxResults)));
      url.searchParams.set("select", "id,doi,display_name,abstract_inverted_index,primary_location");
      url.searchParams.set("api_key", config.apiKey);
      if (config.contactEmail) url.searchParams.set("mailto", config.contactEmail);

      const body = await getJson("openalex", url.toString(), {
        fetchImpl,
        timeoutMs,
        signal,
        headers: { "User-Agent": config.userAgent },
      });
      const parsed = Response.safeParse(body);
      const works = (parsed.success ? (parsed.data.results ?? []) : []).flatMap((raw) => {
        const work = Work.safeParse(raw);
        return work.success ? [work.data] : [];
      });

      return works
        .map((work) => ({
          // A DOI when there is one (OpenAlex gives it as a full https://doi.org/ URL), else the landing page,
          // else the OpenAlex record itself.
          url: work.doi ?? work.primary_location?.landing_page_url ?? work.id,
          title: cleanTitle(work.display_name ?? work.id),
          snippet: cleanSnippet(abstractFromInvertedIndex(work.abstract_inverted_index)),
          provider: "openalex" as const,
        }))
        .filter((result) => result.snippet !== "")
        .slice(0, maxResults);
    },
  };
}

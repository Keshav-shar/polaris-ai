import { z } from "zod";
import type { SearchPort, SearchResult } from "../../application/ports/search.port";
import { SEARCH } from "../../config/constants";
import { cleanSnippet, cleanTitle, type FetchLike, getJson, ProviderHttpError } from "./search-http";

export type IeeeXploreConfig = {
  apiKey: string;
  apiUrl?: string;
  timeoutMs?: number;
  // Injected so the quota circuit is testable without waiting for midnight.
  now?: () => Date;
};

const Article = z.object({
  title: z.string(),
  abstract: z.string().optional().catch(undefined),
  doi: z.string().optional().catch(undefined),
  html_url: z.string().optional().catch(undefined),
  pdf_url: z.string().optional().catch(undefined),
});
const Response = z.object({ articles: z.array(z.unknown()).optional().catch(undefined) });

const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

// IEEE Xplore's Metadata API (opt-in: IEEE_API_KEY, granted on application). Its key carries a DAILY call cap, so
// a 403/429 opens an in-process circuit for the rest of the UTC day: every later lesson skips IEEE at once rather
// than spending a failed request (and a log line) to learn the same thing (C146). IEEE content still reaches the
// writer through Crossref (member 263) while the circuit is open.
export function createIeeeXploreSearch(config: IeeeXploreConfig, fetchImpl: FetchLike = fetch): SearchPort {
  const apiUrl = config.apiUrl ?? SEARCH.IEEE_API_URL;
  const timeoutMs = config.timeoutMs ?? SEARCH.TIMEOUT_MS;
  const now = config.now ?? (() => new Date());
  let exhaustedOn: string | undefined;

  return {
    async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
      if (exhaustedOn !== undefined && exhaustedOn === utcDay(now())) {
        throw new Error("ieee daily quota exhausted; skipped until the next UTC day");
      }
      const url = new URL(apiUrl);
      url.searchParams.set("querytext", query);
      url.searchParams.set("max_records", String(Math.max(1, maxResults)));
      url.searchParams.set("format", "json");
      url.searchParams.set("apikey", config.apiKey);

      let body: unknown;
      try {
        body = await getJson("ieee", url.toString(), { fetchImpl, timeoutMs, signal });
      } catch (error) {
        if (error instanceof ProviderHttpError && (error.status === 403 || error.status === 429)) {
          exhaustedOn = utcDay(now());
        }
        throw error;
      }
      const parsed = Response.safeParse(body);
      const articles = (parsed.success ? (parsed.data.articles ?? []) : []).flatMap((raw) => {
        const article = Article.safeParse(raw);
        return article.success ? [article.data] : [];
      });

      return articles
        .flatMap((article) => {
          const link = article.doi ? `https://doi.org/${encodeURI(article.doi)}` : (article.html_url ?? article.pdf_url);
          if (link === undefined) return [];
          return [
            {
              url: link,
              title: cleanTitle(article.title),
              snippet: cleanSnippet(article.abstract ?? ""),
              provider: "ieee" as const,
            },
          ];
        })
        .filter((result) => result.snippet !== "")
        .slice(0, maxResults);
    },
  };
}

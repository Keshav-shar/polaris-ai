import { z } from "zod";
import type { SearchPort, SearchResult } from "../../application/ports/search.port";
import { SEARCH } from "../../config/constants";
import type { FetchLike } from "./wikipedia.adapter";

export type TavilyConfig = {
  apiKey: string;
  apiUrl?: string;
  timeoutMs?: number;
};

const TavilyResponse = z.object({
  results: z
    .array(
      z.object({
        url: z.string(),
        title: z.string().optional().catch(undefined),
        content: z.string().optional().catch(undefined),
      }),
    )
    .optional()
    .catch(undefined),
});

// Optional second provider. Unlike Wikipedia it spends a metered monthly credit, so it is opt-in through
// SEARCH_PROVIDER=tavily and config/env.ts refuses that setting without TAVILY_API_KEY.
export function createTavilySearch(config: TavilyConfig, fetchImpl: FetchLike = fetch): SearchPort {
  const apiUrl = config.apiUrl ?? SEARCH.TAVILY_API_URL;
  const timeoutMs = config.timeoutMs ?? SEARCH.TIMEOUT_MS;

  return {
    async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);

      const response = await fetchImpl(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          query,
          max_results: Math.max(1, maxResults),
          search_depth: "basic",
        }),
        signal: combined,
      });
      if (!response.ok) {
        // The key is never echoed: the message names the provider and the status only.
        throw new Error(`Tavily search failed with HTTP ${response.status}`);
      }

      const parsed = TavilyResponse.safeParse(await response.json());
      const hits = parsed.success ? (parsed.data.results ?? []) : [];

      return hits.slice(0, maxResults).map((hit) => ({
        url: hit.url,
        title: hit.title ?? hit.url,
        snippet: (hit.content ?? "").replace(/\s+/g, " ").trim(),
      }));
    },
  };
}

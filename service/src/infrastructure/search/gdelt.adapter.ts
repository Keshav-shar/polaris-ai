import { z } from "zod";
import type { SearchPort, SearchResult } from "../../application/ports/search.port";
import { SEARCH } from "../../config/constants";
import { createIntervalGate, type IntervalGate } from "./interval-gate";
import { cleanSnippet, cleanTitle, type FetchLike, getJson } from "./search-http";

export type GdeltConfig = {
  userAgent: string;
  // News sites to restrict to. Default SEARCH.GDELT_DOMAINS: Reuters and AP.
  domains?: readonly string[];
  apiUrl?: string;
  timeoutMs?: number;
  gate?: IntervalGate;
};

const Article = z.object({
  url: z.string(),
  title: z.string().optional().catch(undefined),
  domain: z.string().optional().catch(undefined),
  seendate: z.string().optional().catch(undefined),
});
const Response = z.object({ articles: z.array(z.unknown()).optional().catch(undefined) });

// GDELT parses operators (quotes, parentheses, `domain:`, `-`, `near5:`) out of the query string, and the topic is
// untrusted text from the learner or the model: keep letters, digits and spaces only, so a topic can never widen
// the domain filter or change the query's meaning. Words under 3 characters are dropped (GDELT refuses them).
// Upper-case boolean words are operators to a search parser; as topic words they carry nothing.
const BOOLEAN_WORDS = new Set(["OR", "AND", "NOT"]);

export function sanitizeGdeltQuery(query: string): string {
  return query
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !BOOLEAN_WORDS.has(word))
    .slice(0, 8)
    .join(" ");
}

// "20260301T120000Z" -> "2026-03-01". Anything else is left out rather than guessed.
function day(seendate: string | undefined): string | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})T/.exec(seendate ?? "");
  return match === null ? undefined : `${match[1]}-${match[2]}-${match[3]}`;
}

// Reuters and AP, legally (C146): neither has a free API and both forbid scraping, so their coverage arrives
// through GDELT's free DOC 2.0 index. What GDELT returns is a HEADLINE, its site and the day it was seen - no
// article body - over a rolling ~3 month window. The snippet says exactly that, and the writer prompt treats a
// news source as current context, never as the source of a mechanism or a definition.
export function createGdeltSearch(config: GdeltConfig, fetchImpl: FetchLike = fetch): SearchPort {
  const apiUrl = config.apiUrl ?? SEARCH.GDELT_API_URL;
  const timeoutMs = config.timeoutMs ?? SEARCH.TIMEOUT_MS;
  const domains = config.domains ?? SEARCH.GDELT_DOMAINS;
  const gate =
    config.gate ?? createIntervalGate({ minIntervalMs: SEARCH.GDELT_MIN_INTERVAL_MS, maxWaitMs: SEARCH.GDELT_MAX_WAIT_MS });

  return {
    async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
      const terms = sanitizeGdeltQuery(query);
      if (terms === "") return [];
      // Refused, not awaited, when the next slot is too far off: the lesson goes ahead with the other providers.
      if (!(await gate.acquire(signal))) throw new Error("gdelt rate gate busy; skipped for this lesson");

      const url = new URL(apiUrl);
      const scope = domains.map((domain) => `domain:${domain}`).join(" OR ");
      url.searchParams.set("query", domains.length > 1 ? `${terms} (${scope})` : `${terms} ${scope}`);
      url.searchParams.set("mode", "artlist");
      url.searchParams.set("format", "json");
      url.searchParams.set("sort", "hybridrel");
      url.searchParams.set("maxrecords", String(Math.max(1, maxResults)));

      // A rate-limit refusal comes back as plain text, which getJson reads as `undefined` -> no results.
      const body = await getJson("gdelt", url.toString(), {
        fetchImpl,
        timeoutMs,
        signal,
        headers: { "User-Agent": config.userAgent },
      });
      const parsed = Response.safeParse(body);
      const articles = (parsed.success ? (parsed.data.articles ?? []) : []).flatMap((raw) => {
        const article = Article.safeParse(raw);
        return article.success && article.data.title ? [article.data] : [];
      });

      return articles.slice(0, maxResults).map((article) => {
        const seen = day(article.seendate);
        const where = [article.domain, seen].filter((part) => part !== undefined).join(", ");
        const headline = article.title ?? "";
        return {
          url: article.url,
          title: cleanTitle(headline),
          snippet: cleanSnippet(`News headline${where === "" ? "" : ` (${where})`}: ${headline}`),
          provider: "gdelt" as const,
        };
      });
    },
  };
}

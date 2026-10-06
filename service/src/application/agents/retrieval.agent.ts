import { RETRIEVAL } from "../../config/constants";
import { scoreSource } from "../../domain/credibility/credibility-scorer";
import { EvidenceItem } from "../../domain/schemas/evidence.schema";
import type { SearchPort } from "../ports/search.port";

export type RetrieveRequest = {
  topic: string;
  // The parent's topic disambiguates a subtopic that is meaningless alone: "Paging" retrieves badly,
  // "Paging Memory management" retrieves the right pages (docs/article-generation.md).
  parentTopic: string | null;
  maxResults?: number;
  signal?: AbortSignal;
};

// The query and the time are returned, not dropped: they are the provenance the evidence table needs,
// and this agent is the only place that knows them (docs/conflicts.md C79).
export type RetrievalResult = {
  query: string;
  retrievedAt: string;
  items: EvidenceItem[];
};

export type RetrievalAgent = {
  retrieve(request: RetrieveRequest): Promise<RetrievalResult>;
};

export function buildSearchQuery(topic: string, parentTopic: string | null): string {
  const topicText = topic.trim();
  const parentText = parentTopic?.trim() ?? "";
  // A parent that merely repeats the topic adds nothing and skews the search.
  if (parentText === "" || parentText.toLowerCase() === topicText.toLowerCase()) return topicText;
  return `${topicText} ${parentText}`;
}

// Same page reached by two URLs is one piece of evidence. Compared on origin + path with the trailing
// slash and any fragment removed; query strings are KEPT, because `?curid=` is what identifies a
// Wikipedia page at all.
function dedupeKey(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${path}${parsed.search}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

// No LLM call: this is a search plus a pure scoring rule. The one external call per node in the article
// pass is this search (docs/free-tier-constraints.md).
export function createRetrievalAgent({
  search,
  now = () => new Date(),
}: {
  search: SearchPort;
  // Injected, because the domain rule is that a clock is a dependency, never ambient.
  now?: () => Date;
}): RetrievalAgent {
  return {
    async retrieve({ topic, parentTopic, maxResults = RETRIEVAL.MAX_RESULTS, signal }) {
      const query = buildSearchQuery(topic, parentTopic);
      const results = await search.search(query, maxResults, signal);

      const seen = new Set<string>();
      const evidence: EvidenceItem[] = [];
      for (const result of results) {
        const key = dedupeKey(result.url);
        if (seen.has(key)) continue;
        seen.add(key);
        const candidate = {
          url: result.url,
          title: result.title,
          snippet: result.snippet,
          credibility: scoreSource(result.url),
        };
        // Validated rather than trusted: a provider can return a URL that is not one, and a malformed
        // entry must be dropped here rather than reaching a citation.
        const parsed = EvidenceItem.safeParse(candidate);
        if (parsed.success) evidence.push(parsed.data);
        if (evidence.length >= maxResults) break;
      }
      // Best first, so a truncated prompt keeps the strongest sources. Stable within equal scores.
      return {
        query,
        retrievedAt: now().toISOString(),
        items: evidence.sort((a, b) => b.credibility - a.credibility),
      };
    },
  };
}

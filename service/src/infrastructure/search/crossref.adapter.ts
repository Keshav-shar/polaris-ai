import { z } from "zod";
import type { SearchPort, SearchResult } from "../../application/ports/search.port";
import { SEARCH } from "../../config/constants";
import { cleanSnippet, cleanTitle, type FetchLike, getJson } from "./search-http";

export type CrossrefConfig = {
  // Crossref's "polite pool" is for clients that identify themselves: a User-Agent and a mailto.
  userAgent: string;
  contactEmail?: string;
  // Crossref publisher (member) ids to search within. Default SEARCH.CROSSREF_MEMBERS: Cambridge, Oxford, IEEE.
  members?: readonly number[];
  apiUrl?: string;
  timeoutMs?: number;
};

// The slice of `/works` we rely on (recorded live 2026-11-08): `message.items[]` with `DOI`, `title` (an array)
// and `abstract` as JATS XML. Parsed, not cast; an item that does not parse is skipped.
const Item = z.object({
  DOI: z.string().min(1),
  title: z.array(z.string()).optional().catch(undefined),
  abstract: z.string().optional().catch(undefined),
  publisher: z.string().optional().catch(undefined),
});
const Response = z.object({
  message: z.object({ items: z.array(z.unknown()).optional().catch(undefined) }).optional().catch(undefined),
});

// JATS block tags end a sentence or a heading: a space keeps "Abstract" and the first sentence apart once the
// tags are stripped. The leading "Abstract" heading itself carries nothing.
export function jatsToText(jats: string): string {
  return jats
    .replace(/<\/?jats:(p|title|sec|list-item|list)[^>]*>/g, " ")
    .replace(/^\s*Abstract\s+/i, "");
}

// Cambridge University Press, Oxford University Press and IEEE through ONE keyless index (C146): Crossref holds
// their DOIs, titles and (for many works) abstracts. Only works WITH an abstract are asked for - a title alone
// gives a claim nothing to rest on.
export function createCrossrefSearch(config: CrossrefConfig, fetchImpl: FetchLike = fetch): SearchPort {
  const apiUrl = config.apiUrl ?? SEARCH.CROSSREF_API_URL;
  const timeoutMs = config.timeoutMs ?? SEARCH.TIMEOUT_MS;
  const members = config.members ?? SEARCH.CROSSREF_MEMBERS;

  return {
    async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
      const url = new URL(apiUrl);
      url.searchParams.set("query.bibliographic", query);
      // A repeated filter name is an OR in Crossref; `has-abstract` is ANDed with it.
      url.searchParams.set("filter", [...members.map((m) => `member:${m}`), "has-abstract:true"].join(","));
      url.searchParams.set("rows", String(Math.max(1, maxResults)));
      url.searchParams.set("select", "DOI,title,abstract,publisher");
      if (config.contactEmail) url.searchParams.set("mailto", config.contactEmail);

      const body = await getJson("crossref", url.toString(), {
        fetchImpl,
        timeoutMs,
        signal,
        headers: { "User-Agent": config.userAgent },
      });
      const parsed = Response.safeParse(body);
      const items = (parsed.success ? (parsed.data.message?.items ?? []) : []).flatMap((raw) => {
        const item = Item.safeParse(raw);
        return item.success ? [item.data] : [];
      });

      return items
        .map((item) => {
          const title = item.title?.[0] ?? item.DOI;
          return {
            // The DOI resolver is the stable, publisher-independent link to the work.
            url: `https://doi.org/${encodeURI(item.DOI)}`,
            title: cleanTitle(item.publisher === undefined ? title : `${title} (${item.publisher})`),
            snippet: cleanSnippet(jatsToText(item.abstract ?? "")),
            provider: "crossref" as const,
          };
        })
        .filter((result) => result.snippet !== "")
        .slice(0, maxResults);
    },
  };
}

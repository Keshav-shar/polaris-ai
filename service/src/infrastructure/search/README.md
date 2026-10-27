# search/

**Purpose:** Web-search adapters used by the retrieval agent in the article pass.

**May depend on:** application/ports, domain.

**Must not depend on:** LLM adapters.

**Planned contents:**
- `cached-search.adapter.ts` — built (10.9, C126). `createCachedSearch(inner)`: bounded LRU + TTL in front of any search; failures never cached; wrapped in `composition/search.ts`.
- `wikipedia.adapter.ts` — built (Phase 9); since 10.9 ONE `generator=search` + `prop=extracts` call returns each hit's plain-text intro, ordered by search rank, pages without text dropped (C122). MediaWiki `list=search`, `SEARCH_USER_AGENT`, HTML
  stripped and entities decoded, canonical `?curid=` URLs (rename-proof, because citations are read
  back much later), `SEARCH.TIMEOUT_MS` combined with the caller's signal, and an injectable `fetch`
  so its tests need no network. A body it cannot parse is an EMPTY result set, not a throw: a node
  with no sources still gets an unverified article rather than failing the run
- `tavily.adapter.ts` — built (Phase 9). Bearer auth on the same port, opt-in via
  `SEARCH_PROVIDER=tavily`; the key is never echoed in an error message
- Both wrap the whole fetch + body read in `withStallOnTransportFault` (in `wikipedia.adapter.ts`): a search
  that never completed - DNS, socket, our own timeout - raises `TransportUnavailableError`, which the article
  worker releases uncounted with a delay; an HTTP status stays an ordinary error (Phase 10.7, C115). Title and
  snippet are bounded by `capText` (C103)

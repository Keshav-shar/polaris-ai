# search/

**Purpose:** Web-search adapters used by the retrieval agent in the article pass.

**May depend on:** application/ports, domain.

**Must not depend on:** LLM adapters.

**Planned contents:**
- `wikipedia.adapter.ts` — built (Phase 9). MediaWiki `list=search`, `SEARCH_USER_AGENT`, HTML
  stripped and entities decoded, canonical `?curid=` URLs (rename-proof, because citations are read
  back much later), `SEARCH.TIMEOUT_MS` combined with the caller's signal, and an injectable `fetch`
  so its tests need no network. A body it cannot parse is an EMPTY result set, not a throw: a node
  with no sources still gets an unverified article rather than failing the run
- `tavily.adapter.ts` — built (Phase 9). Bearer auth on the same port, opt-in via
  `SEARCH_PROVIDER=tavily`; the key is never echoed in an error message

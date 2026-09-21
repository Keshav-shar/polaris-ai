# search/

**Purpose:** Web-search adapters used by the retrieval agent in the article pass.

**May depend on:** application/ports, domain.

**Must not depend on:** LLM adapters.

**Planned contents:**
- `wikipedia.adapter.ts` — MediaWiki `list=search`, `SEARCH_USER_AGENT`, HTML stripped, canonical URLs, 15 s timeout (Phase 9)
- `tavily.adapter.ts` — Bearer auth, same port (Phase 9)

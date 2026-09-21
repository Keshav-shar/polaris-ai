# e2e/

**Purpose:** Tests against the HTTP interface with in-memory adapters (vitest; add Supertest when needed). The MVP's API is checked by hand with curl.

**May depend on:** interfaces/http, composition (test wiring).

**Must not depend on:** Live LLM calls.

**Planned contents:**
- `api/trees.routes.test.ts` and one file per route module (optional, Phase 14)

# integration/

**Purpose:** Adapter tests against a local Postgres (Supabase CLI), verifying the SQL actually works.

**May depend on:** infrastructure, fixtures.

**Must not depend on:** Hosted Supabase/AWS accounts (must run offline for free).

**Planned contents:**
- `postgres/*.test.ts` — ltree subtree queries, resume from a half-built level, idempotent upserts (Phase 12)

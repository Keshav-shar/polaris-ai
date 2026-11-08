# integration/

**Purpose:** Adapter tests against a local Postgres (Supabase CLI), verifying the SQL actually works.

**May depend on:** infrastructure, fixtures.

**Must not depend on:** Hosted Supabase/AWS accounts (must run offline for free).

**Planned contents:**
- `postgres/*.test.ts` — ltree subtree queries, resume from a half-built level, idempotent upserts (Phase 12)

**Built (Phase 12):** `postgres-storage.test.ts` — every Postgres adapter, the RPCs, RLS (with the anon key) and
the auth-user cascade, against a LOCAL `supabase start` stack only: set `SUPABASE_TEST_URL` (must be
`http://127.0.0.1:54321` or `localhost`; anything else throws), `SUPABASE_TEST_SERVICE_ROLE_KEY`, and optionally
`SUPABASE_TEST_ANON_KEY` from `npx supabase status`. Skipped when they are unset. Note: the root `.gitignore` has a
bare `integration/` rule, which also ignores this folder.

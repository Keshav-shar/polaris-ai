# postgres/

**Purpose:** Supabase Postgres adapters: the permanent system of record for runs, nodes, evidence, articles and quizzes.

**May depend on:** application/ports, domain, `@supabase/supabase-js`.

**Must not depend on:** Other adapters, use-cases.

**Planned contents:**
- `supabase.client.ts` — client factory (server-side, service role; never exposed to the browser)
- `run.repository.ts`, `tree.repository.ts` (ltree paths from ids), `article.repository.ts`, `evidence.repository.ts`, `quiz.repository.ts` (Phase 12)
- `mappers/` (add when needed) — row to entity mapping kept out of repositories

**Design notes:**
- Lambdas and Express both use supabase-js over HTTPS (no direct 5432 connections that would exhaust Supabase's limit).
- Writes are upserts keyed by `node_id`, so redelivered messages are harmless.
- Supabase free tier is 500 MB, has no backups, and pauses after 7 days of inactivity.

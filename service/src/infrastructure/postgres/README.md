# postgres/

**Purpose:** Supabase Postgres adapters for Tier B (topics, evidence, articles, quizzes) and teaching-agent config.

**May depend on:** application/ports, domain, `@supabase/supabase-js`.

**Must not depend on:** DynamoDB, use-cases.

**Planned contents:**
- `postgres.client.ts` — client init (server-side, service role; never expose to the browser)
- `topic.repository.ts`, `evidence.repository.ts`, `teaching-agent.repository.ts`
- `mappers/` (add when needed) — row to entity mapping kept out of repositories

**Design notes:**
- Issue 10: Supabase free tier is 500 MB, has no backups, and pauses after 7 days of inactivity (10-30 s cold start). Plan for a keep-alive or accept the cold start, and export data periodically.
- Use pgvector similarity via a Postgres function (RPC) so the query stays in SQL.

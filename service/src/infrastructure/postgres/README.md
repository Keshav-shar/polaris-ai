# postgres/

**Purpose:** Supabase Postgres adapters: the permanent system of record for runs, nodes, evidence, articles and quizzes.

**May depend on:** application/ports, domain, `@supabase/supabase-js`.

**Must not depend on:** Other adapters, use-cases.

**Contents (Phase 12, built 2026-11-01):**
- `supabase.client.ts` — `createSupabaseServiceClient({ url, serviceRoleKey })`: server-side, service role, no session
- `postgres-error.ts` — `dbFailure(op, error)` / `check(op, result)`: a request that never completed ->
  `DependencyUnavailableError` (503); anything Postgres refused -> `Error` naming the op + SQLSTATE, never `details`
- `run.repository.ts` — `RunRepositoryPort` incl. `listByOwner`, `listPublic`, `setVisibility`, `setStats`,
  `pruneForOwner` (RPC), `haltInterrupted` (RPC); never reads `request` back
- `tree.repository.ts` — writes through `upsert_nodes` (forward-only, brief never blanked, duplicate ids collapsed);
  `getNode` = 2 indexed reads in parallel; `getTree` = one read ordered by `seq`
- `article.repository.ts` (`save_article` RPC), `evidence.repository.ts` (`replace_evidence` RPC),
  `quiz.repository.ts`, `expansion-cache.store.ts` (a stored value that no longer validates reads as a miss),
  `usage.store.ts` (`reserve_user_run` RPC)
- Every row read is parsed with Zod before it becomes a domain value (DB JSON is a trust boundary)

**Design notes:**
- Lambdas and Express both use supabase-js over HTTPS (no direct 5432 connections that would exhaust Supabase's limit).
- Writes are upserts keyed by `node_id`, so redelivered messages are harmless.
- Supabase free tier is 500 MB, has no backups, and pauses after 7 days of inactivity.

**Phase C:** `progress.repository.ts` (`mark_node_read`, `record_quiz_attempt`), `feedback.repository.ts`
(`lesson_feedback` upsert, re-validated against the closed vocabulary), `insight.repository.ts` (`learner_insights`,
profile re-validated on the way OUT - it enters prompts). Every per-user read filters by the caller's `user_id`.
`usage.store.ts` adds `reserve_user_insight`.

**C143:** `schema-probe.ts` (`probeSchema`): one `limit 0` select per table and per late column, returning what is
missing; called by `container.checkStorage()` at startup. `postgres-error.ts` exports `isSchemaMissing` and now
counts `42703` (undefined column) as a missing schema.

**Phase 13:** `article-draft.repository.ts` (`article_drafts`, `put_article_draft`; validated in and out).

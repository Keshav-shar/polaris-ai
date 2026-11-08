# migrations/

**Purpose:** Ordered, forward-only DDL for the Postgres schema (`docs/data-model.md`). One concern per file.

**May depend on:** Nothing.

**Must not depend on:** Seed data.

**Contents (Phase 12, C105-C107, C137):**
- `0001_extensions.sql` — `ltree`, `pgcrypto` in the `extensions` schema (`vector` only when Q7 schedules it)
- `0002_profiles.sql` — one row per `auth.users` user via the `on_auth_user_created` trigger (`security definer`,
  empty `search_path`); backfills existing users
- `0003_runs.sql` — owned run record: `owner_id`, `visibility`, `request`, `stats`, `prompt_version`, `version`
  (bumped by the `runs_touch` trigger), indexes `(owner_id, created_at desc)`, public partial, constructing partial
- `0004_nodes.sql` — ltree `path` from ids, `unique (run_id, path)`, gist index, `seq` identity for sibling order
- `0005_evidence.sql` — per-node sources with `position` and provenance
- `0006_articles.sql` — one per node; `citations jsonb` = `[{ url, claim, evidence_id }]`
- `0007_quizzes.sql` — one per node, `questions jsonb`
- `0008_node_progress.sql` — per-user read state + quiz results (written from Phase C / 12.1)
- `0009_usage_daily.sql` — per-user daily counters
- `0010_expansion_cache.sql` — the cache `ExpansionCachePort` promises (C47)
- `0011_rls.sql` — RLS on all 9 tables, NO policies, grants revoked from `anon`/`authenticated`
- `0012_rpc.sql` — `upsert_nodes`, `replace_evidence`, `save_article`, `reserve_user_run`, `prune_user_runs`,
  `halt_interrupted_runs`; each revoked from `public`/`anon`/`authenticated`, granted to `service_role`

- `0013_lesson_feedback.sql` — lesson tags (C138): closed vocabulary, no free-text column, RLS on
- `0014_learner_insights.sql` — one insight per learner (C139); index `node_progress (user_id, updated_at desc)`
- `0015_progress_rpc.sql` — `mark_node_read`, `record_quiz_attempt`, `reserve_user_insight` (+ `usage_daily.insights_generated`)
- `0016_article_drafts.sql` — the writer's stored draft when node state is in DynamoDB (A14, A23)
- `0017_evidence_provider.sql` — `evidence.provider` + `replace_evidence` storing it (C146)

**Design notes:**
- ltree labels: `[A-Za-z0-9_]` only (`n_<uuid without hyphens>`), built from ids, never titles.
- SQL checks are generous safety nets, not copies of `config/constants.ts`: values live in code only.
- Every function pins `search_path`; the trigger functions pin it to empty and schema-qualify every name.
- Verified 2026-11-01 by applying all 12 to PGlite (Postgres in WASM, `ltree` + `pgcrypto`) and exercising every
  RPC, the trigger, RLS flags, grants and the auth-user cascade; not yet applied to a real Supabase stack. 0013-0015 verified the same way on 2026-11-07 (PGlite 0.3.14 ships no
  `pgcrypto`; nothing here needs it, `gen_random_uuid()` is core).

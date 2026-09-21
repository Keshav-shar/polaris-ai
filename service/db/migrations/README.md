# migrations/

**Purpose:** Ordered, forward-only DDL for the Postgres schema (`docs/data-model.md`). One concern per file so history stays reviewable.

**May depend on:** Nothing.

**Must not depend on:** Seed data. Data changes go in ../seeds.

**Planned contents:**
- `0001_extensions.sql` — `ltree`, `vector`, `pgcrypto`
- `0002_runs.sql` — durable run record (FK target of `nodes`)
- `0003_nodes.sql` — ltree `path` from ids, gist index, `unique (run_id, path)`, status, brief, embedding
- `0004_evidence.sql` — per-node sources with provenance
- `0005_articles.sql` — one row per node
- `0006_quizzes.sql` — one row per node, `questions jsonb`

**Design notes:**
- ltree labels: `[A-Za-z0-9_-]` only, max 1000 chars. Build `path` from node ids, never titles.
- `vector(N)` must equal `EMBEDDING_DIMENSION` in `config/constants.ts`.
- Written in Phase 12.

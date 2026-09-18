# migrations/

**Purpose:** Ordered, forward-only DDL for the Postgres schema (plan section 5.1). One concern per file so history stays reviewable.

**May depend on:** Nothing.

**Must not depend on:** Seed data. Data changes go in ../seeds.

**Planned contents:**
- `0001_extensions.sql` — `ltree`, `vector`, `pgcrypto`/`gen_random_uuid`
- `0002_teaching_agents.sql` — must run BEFORE topic_configs (FK target)
- `0003_topic_configs.sql` — content-reuse key (`config_hash`)
- `0004_topics.sql` — ltree `path`, gist index, `unique (config_id, path)`
- `0005_evidence.sql` — pgvector embedding column + index
- `0006_articles.sql`, `0007_quizzes.sql` — one row per topic
- `0008_tree_runs.sql` — durable run record (see issue 4)
- `0009_rls_policies.sql` — superadmin write, authenticated read of active agents

**Design notes:**
- Issue 1: plan section 5.1 creates `topic_configs` before `teaching_agents`, which it references. Create `teaching_agents` first.
- Issue 2: ltree labels allow only `[A-Za-z0-9_-]` and max 1000 chars. Build `path` from node ids/slugs, never raw titles; keep the title in its own column.
- Issue 3: `config_hash` covers root topic + agent id + max height but not the traversal plan or personality. Editing an agent would silently reuse stale content. Add an `agent_version` (or hash of plan + personality) to the hash input.
- Issue 4: there is no durable run record. `GET /trees/:id` needs run status, but Tier A expires after 48h. Add a `tree_runs` row (status, config_id, timestamps).
- Issue 5: RLS 'superadmin' needs Supabase Auth plus a role claim; the plan defines no user/role model.
- Embedding dimension (`vector(1536)`) is tied to one embedding model; keep it in sync with `config/constants.ts`.

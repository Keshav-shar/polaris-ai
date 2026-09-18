# seeds/

**Purpose:** Idempotent seed data for reference tables. Superadmin path for creating teaching agents (plan section 8, step 6).

**May depend on:** Nothing. Runs after migrations.

**Must not depend on:** Schema changes. Those belong in ../migrations.

**Planned contents:**
- `teaching_agents.seed.sql` — Brisk Overview (BFS), PhD Deep Dive (DFS), Guided Explorer (Custom staged); use upsert-by-name so re-running is safe

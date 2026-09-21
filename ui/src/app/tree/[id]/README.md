# [id]/

**Purpose:** Tree navigation page for a persisted run.

**May depend on:** ui/src/components, ui/src/lib.

**Must not depend on:** Direct database access.

**Planned contents:**
- `page.tsx` — polls `GET /api/trees/:id`; renders the tree as levels complete (Phase 8 (build plan); Postgres-backed from Phase 12)

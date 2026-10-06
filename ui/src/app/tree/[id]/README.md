# [id]/

**Purpose:** Tree navigation page for a persisted run.

**May depend on:** ui/src/components, ui/src/lib.

**Must not depend on:** Direct database access.

**Planned contents:**
- `page.tsx` — built (Phase 8). A server component: Next 16 delivers route `params` as a **Promise**, so it
  awaits them and hands the id to the client `<RunPanel>`, which does the polling. Postgres-backed from
  Phase 12

# [id]/

**Purpose:** Article page for one node.

**May depend on:** ui/src/components, ui/src/lib.

**Must not depend on:** Direct database access.

**Planned contents:**
- `page.tsx` — node article with citations, parent link and child links; shows the parent page as soon as it loads while child articles stream in (progressive display, Phase 10); quiz below the article, fetched on demand (Phase 11)

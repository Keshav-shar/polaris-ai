# [id]/

**Purpose:** Article page for one node.

**May depend on:** ui/src/components, ui/src/lib.

**Must not depend on:** Direct database access.

**Planned contents:**
- `page.tsx` — built as a SHELL (Phase 9). Awaits the Next 16 Promise `params` and hands the id to the
  client `<ScrollReader>`, which shows the node's topic, brief and tree position, an explicit "scroll
  not yet written" state, and the empty "Trial of Knowledge" panel. **Phase 10** fills the article
  (scope-sized and cited, rendered as markdown by `article-body.tsx`) and the 3 questions that arrive in the same writer call (C74), adds progressive
  display, and replaces `<ScrollReader>`'s multi-run lookup with one `GET /api/nodes/:nodeId` — the
  lookup is a search across runs today only because that endpoint does not exist yet

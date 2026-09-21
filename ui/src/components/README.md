# components/

**Purpose:** Reusable presentational components.

**May depend on:** ui/src/lib.

**Must not depend on:** Route files.

**Planned contents:**
- `api-status.tsx` — client component: calls `GET /health`, shows connected / unreachable and whether an LLM key is set (Phase 2)
- `tree-view.tsx` — recursive `<details>/<summary>`: topic, depth, brief (Phase 8)
- `article-view.tsx` — markdown article + citations + credibility badge (Phase 10)
- `quiz-widget.tsx` — renders a node's quiz, scores it client-side against `PASSING_SCORE_PERCENT`; nothing persisted (Phase 11)

# components/

**Purpose:** Reusable presentational components.

**May depend on:** ui/src/lib.

**Must not depend on:** Route files.

**Planned contents:**
- `api-status.tsx` — client component: calls `GET /health`, shows connected / unreachable and whether an LLM key is set (Phase 2)
- `site-header.tsx` — client: brand + nav, active tab from `usePathname`. Three tabs, not the
  reference's four: the Sanctuary of Sages is a teaching-agent surface and those are deferred (C30)
- `star-field.tsx` — client: the reference's canvas starfield. `aria-hidden`, capped at 2x DPR and
  ~220 stars, and it paints one static frame instead of animating under `prefers-reduced-motion`
- `constellation-view.tsx` — client: focus+context orbital cluster with SVG edges; clicking any star
  re-centres. Layout comes from the pure `lib/constellation-layout.ts` (Phase 9, built)
- `tree-directory.tsx` — client: the whole tree as the sidebar "Constellation Roadmap" (recursive
  `<details>`), which is what lets the constellation draw only a neighbourhood. Replaced the Phase 8
  `tree-view.tsx`, which was deleted rather than left orphaned. Every row does BOTH things the
  constellation does — the name re-centres the map, the star opens the scroll — because a node reachable
  from one surface and not the other is a bug, which is exactly what C84 was
- `codex-library.tsx` — client: one `getRuns` then one `getTree` per run, listed as ONE codex per tree that
  expands in place into its nested scrolls (C83 — Phase 9 flattened every node into a sibling card, so a
  34-node run buried its own structure). Searching forces matching codices open, or a hit inside a collapsed
  one would be unreachable. Read-only, so it never polls; one unreadable run cannot blank the library
- `scroll-reader.tsx` — client: the article reader. Phase 9 shows topic, brief, tree position and an
  explicit "not yet written" state. Phase 10 filled it: one `getNode` call now returns the article, its
  citations, a sourced/unverified badge and the 3 questions, replacing Phase 9's search across every run
- `article-body.tsx` — the markdown SUBSET the writer actually emits (h2/h3, bulleted lists with one
  nesting level, paragraphs, `**bold**`, `` `code` ``) plus `readingMinutes`. Built from React elements and
  never `dangerouslySetInnerHTML`: the content is LLM output partly derived from retrieved web snippets, so
  injection is made structurally impossible rather than a sanitiser config to keep right. Anything outside
  the subset renders as literal characters (C88)
- `empty-state.tsx` — presentational: one shape for every "nothing here yet" panel, so empty states read
  as deliberate rather than broken. (`scroll-card.tsx` was deleted in Phase 10: the Codex lists one entry
  per TREE now, and `scroll-branch.tsx` renders the nesting — C83)
- `topic-form.tsx` — client: prompt (1-500 chars, matching `TreeRequestBody`) + optional depth cap, default
  `auto` = send no `maxDepth` at all. Disabled while submitting; maps 429 + `Retry-After` to a wait message
  rather than an error (Phase 8, built)
- `run-panel.tsx` — client: polls `GET /api/trees/:runId` every 2 s in a chained (never overlapping) loop
  while the run is `constructing` or `constructed` (articles still land in `constructed`), and renders the tree plus `nodesSkipped` / `nodesFailed` /
  `haltReason` notices. `halted` and `failed` are terminal, or the UI would poll forever (Phase 8).
  Phase 9: owns the focused node and composes `<TreeDirectory>` with `<ConstellationView>`; the index
  and node count are memoised on the tree, not rebuilt on every focus click
- `tree-builder.tsx` — client: owns the current `runId` and composes the form with the panel, keyed by
  `runId` so a second build remounts instead of merging two runs (Phase 8, built)
- ~~`article-view.tsx`~~ — folded into `scroll-reader.tsx` instead of a separate component: the article,
  its citations and the sourced/unverified badge are the reader's own content, not a reusable widget
- `quiz-panel.tsx` — built (Phase 10, replacing the planned `quiz-widget.tsx`): renders the 3 questions
  that came with the article, scored entirely client-side, revealing the right answer and its source on
  submit. Nothing about an attempt is sent or stored
- `scroll-branch.tsx` — one scroll and its descendants inside a codex; the indent IS the knowledge tree.
  Replaced `scroll-card.tsx`, which was deleted rather than left orphaned (C83)

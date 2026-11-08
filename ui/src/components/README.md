# components/

**Purpose:** Reusable presentational components.

**May depend on:** ui/src/lib.

**Must not depend on:** Route files.

**Planned contents:**
- `api-status.tsx` — client component: calls `GET /health`, shows connected / unreachable and whether an LLM key is set (Phase 2)
- `site-header.tsx` — client: round "P" logo + "POLARIS" + subtitle, nav links from `usePathname`.
  The mock has three links (Learn, My library, My progress); "My progress" is added with its page in
  Phase C, never as a dead link (C135). `/tree` and `/topic` highlight "My library"
- `hero-illustration.tsx` — server: the mock's decorative SVG card (`aria-hidden`), caption only is read
- `feature-cards.tsx` — server: the mock's four-card band, rewritten as what Polaris does for a learner
- ~~`star-field.tsx`~~ — deleted with the astral theme (C135)
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
  `auto` = send no `maxDepth` at all. Disabled while submitting; errors go through `lib/friendly-error.ts`
  (429 + `Retry-After` reads as "try again in N minutes", not an error); a `role="status"` toast confirms a
  started map (C135)
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
  that came with the article ("Check your understanding"), scored by the service since Phase C, revealing the
  right answer and its source from the attempt's response. Attempts are stored for a signed-in learner (C106)
- `scroll-branch.tsx` — one scroll and its descendants inside a codex; the indent IS the knowledge tree.
  Replaced `scroll-card.tsx`, which was deleted rather than left orphaned (C83)
- `account-button.tsx` — Phase 12: header sign-in link (with `?next=`) or email + sign-out; nothing when auth is off
- `sign-in-form.tsx` — email magic link (`signInWithOtp`) + GitHub (`signInWithOAuth`), both returning to
  `/auth/callback`; provider error text never shown
- `auth-callback.tsx` — waits for the PKCE exchange (explicit `exchangeCodeForSession` if the client did not), then
  `takeNext()`; a failed link says so plainly
- `share-control.tsx` — owner-only select: Only me / Anyone with the link / Everyone (`PATCH /api/trees/:runId`)
- `codex-library.tsx` (Phase 12): "My maps" / "Explore" tabs (`scope`), reloads on sign-in/out, a sign-in prompt
  on 401. `topic-form.tsx`: a sign-in prompt on 401 and a toast naming pruned maps. `run-panel.tsx`: the share
  control for the owner

**Phase C (C106, C138, C140):** `quiz-panel.tsx` now posts the answers and shows the key, explanations and sources
from the response (the questions arrive without them); `lesson-feedback.tsx` (signed in: a thumb + closed tags,
saved on each click); `scroll-reader.tsx` marks a written lesson read once per open when signed in;
`tree-directory.tsx` shows the reader's ✓ read / best quick-check score per topic. No `/progress` page (C140).

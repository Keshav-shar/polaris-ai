# app/

**Purpose:** Next.js App Router routes.

**May depend on:** ui/src/components, ui/src/lib.

**Must not depend on:** Direct database access.

**Planned contents:**
- `layout.tsx`, `page.tsx` — Phase 2: title + API status line; Phase 8: `page.tsx` stays a SERVER
  component composing `<ApiStatus>` with the client `<TreeBuilder>`. Phase 9: `layout.tsx` owns the
  astral shell — fonts, `<StarField>`, `<SiteHeader>`, the single `<main>` and the footer — so a page
  renders only its own content and never its own `<main>`
- `globals.css` — Tailwind v4 entry (`@import "tailwindcss"`) plus the astral theme as `@theme`
  tokens; there is NO `tailwind.config.js` in v4. Dark-only: the astral palette has no light variant,
  so `color-scheme: dark` is declared and the Phase 8 `prefers-color-scheme` pair is gone (C72). Keeps
  an always-visible focus ring, and a `prefers-reduced-motion` block that stops every orbit, torch and
  starfield animation (Phase 9)
- `codex/page.tsx` — the Astral Codex: every charted node as a scroll card, client-side search
  (Phase 9, built; excerpts become real articles in Phase 10)
- See the sub-folders for later routes.

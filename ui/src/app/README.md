# app/

**Purpose:** Next.js App Router routes.

**May depend on:** ui/src/components, ui/src/lib.

**Must not depend on:** Direct database access.

**Planned contents:**
- `layout.tsx`, `page.tsx` — `page.tsx` stays a SERVER component: the hero copy, `<ApiStatus>` and
  `<HeroIllustration>` are server-rendered slots handed to the client `<TreeBuilder>`, followed by
  `<FeatureCards>` (the mock's layout, C135). `layout.tsx` owns the shell — fonts, `<SiteHeader>`, the
  single `<main>` and the footer — so a page renders only its own content and never its own `<main>`
- `globals.css` — Tailwind v4 entry (`@import "tailwindcss"`) plus the parchment theme as `@theme`
  tokens (`parchment`, `card`, `ink`, `muted`, `subtle`, `faint`, `gold`, `gold-ink`, `line`, `rule`,
  `danger`, `warn`, ...); there is NO `tailwind.config.js` in v4. Light-only, `color-scheme: light`
  (C135, replacing C72's dark astral theme). Gold TEXT uses `gold-ink` for >= 4.5:1 contrast. Keeps an
  always-visible focus ring and a `prefers-reduced-motion` block that stops every animation/transition
- `codex/page.tsx` — "My library": one card per map, expanding into its lessons, client-side search
- See the sub-folders for later routes.

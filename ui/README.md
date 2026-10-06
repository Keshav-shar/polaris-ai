# ui/

**Purpose:** Next.js frontend, deployed to Vercel Hobby. Named `ui` to avoid confusion with Next's `app/` router directory.

**May depend on:** The backend HTTP contract only, plus Tailwind v4 as a BUILD-TIME dev dependency
(`tailwindcss`, `@tailwindcss/postcss`) — nothing of it reaches the runtime bundle but CSS
(docs/conflicts.md C72).

**Must not depend on:** service/src, with one exception: type-only imports from `service/src/domain/schemas`, made in a single file, `src/lib/contract.ts`. No runtime code (and no Zod) may cross the boundary.

**Planned contents:**
See the sub-folders; this folder holds no files of its own.

**Design notes:**
- `AGENTS.md`: this Next version has breaking changes; read `node_modules/next/dist/docs/` before writing Next code.

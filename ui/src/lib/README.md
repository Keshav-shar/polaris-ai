# lib/

**Purpose:** API client and contract types.

**May depend on:** Standard library, fetch.

**Must not depend on:** Components or routes.

**Planned contents:**
- `api-client.ts` — typed wrapper around the backend API (`NEXT_PUBLIC_API_URL`): `getHealth`,
  `startTree`, `getTree`, `isRunInProgress`, and `ApiClientError` (the API's `error.code`, HTTP status and
  `Retry-After` seconds). The service's `RunStatus` / `TreeNodeStatus` members are repeated here as runtime
  arrays because only TYPES may cross the package boundary; type-level assertions make a change to either
  enum a `tsc` failure in this file instead of silent drift
- `constellation-layout.ts` — pure, I/O-free: `indexTree`, `flattenTree`, `buildConstellation`
  (focus + parent + siblings + children as viewport percentages). Draws a neighbourhood, never all 500
  nodes, and takes the nested tree the API already returns so the constellation needs no new endpoint
- `contract.ts` — the one place that re-exports types (`import type` / `export type` only) from `service/src/domain/schemas`, so the UI and API cannot drift. If `next build` rejects the cross-package path, fall back to hand-copied types here.
- `friendly-error.ts` — `friendlyError(error, fallback?)`: maps the API's stable `error.code` (and `Retry-After` on a 429)
  to one plain learner sentence, so developer-facing API text never reaches the page (C135)
- `supabase-browser.ts` — Phase 12 (C105): `authEnabled`, `getSupabase()` (the `@supabase/ssr` browser client, PKCE,
  AUTH ONLY - never a table read), `accessToken()`, `safeNext(path)` (same-site paths only), `rememberNext` /
  `takeNext` (the post-sign-in target in sessionStorage, because Supabase's redirect allow-list is exact)
- `use-session.ts` — `useSession()` -> `disabled | loading | signed-out | signed-in { userId, email }`, live across
  tabs via `onAuthStateChange`
- `api-client.ts` (Phase 12): every request carries `Authorization: Bearer <access token>` when signed in;
  `getRuns(scope)`, `setRunVisibility(runId, visibility)`; guards accept `visibility`, `isOwner`, `authRequired`,
  `prunedRuns`. `friendly-error.ts` adds `unauthenticated`, `user_quota_exhausted`, `service_unavailable` and
  `needsSignIn(error)`

**Phase C:** `api-client.ts` adds `submitQuizAttempt`, `markLessonRead`, `saveLessonFeedback`; `contract.ts`
re-exports the types from `progress.schema.ts` and `feedback.schema.ts`.

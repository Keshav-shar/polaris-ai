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

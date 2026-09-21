# lib/

**Purpose:** API client and contract types.

**May depend on:** Standard library, fetch.

**Must not depend on:** Components or routes.

**Planned contents:**
- `api-client.ts` — typed wrapper around the backend API (`NEXT_PUBLIC_API_URL`)
- `contract.ts` — the one place that re-exports types (`import type` / `export type` only) from `service/src/domain/schemas`, so the UI and API cannot drift. If `next build` rejects the cross-package path, fall back to hand-copied types here.

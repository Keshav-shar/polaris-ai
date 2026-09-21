# routes/

**Purpose:** One router per resource. Handlers stay a few lines long.

**May depend on:** application/use-cases, domain/schemas, interfaces/http/middleware.

**Must not depend on:** Repositories, queues or agents.

**Contents:**
- `trees.routes.ts` — `createTreesRouter({ startTreeBuild(), getTree() })`, mounted at `/api/trees` (Phase 7):
  - `POST /` — body `TreeRequestBody` (`prompt`, optional `maxDepth`) → **202** `StartTreeResponse`. Kickoff only: it sends the root message and returns, so the build never runs inside the request
  - `GET /:runId` — uuid-validated → **200** `TreeResponse` (run status + every known node with its real status + stats; articles from Phase 10)
- `nodes.routes.ts` — `GET /api/nodes/:id/quiz` (Phase 11; generate on first request, then cached)

**Design notes:**
- The read routes never touch AWS: they read the repositories (Postgres from Phase 12).
- Deps are **accessor functions**, not use-case instances: `composition/container.ts` builds the stack on first use, so an unconfigured LLM surfaces as a 503 per request instead of a dead process, and `startTreeBuild()` also restarts a halted worker (docs/conflicts.md C64, C55).
- Express 5 forwards a rejected handler promise to the error middleware, so handlers need no try/catch.
- 202, never 201: the tree does not exist when the response is sent.

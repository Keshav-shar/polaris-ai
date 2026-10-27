# routes/

**Purpose:** One router per resource. Handlers stay a few lines long.

**May depend on:** application/use-cases, domain/schemas, interfaces/http/middleware.

**Must not depend on:** Repositories, queues or agents.

**Contents:**
- `trees.routes.ts` — `createTreesRouter({ startTreeBuild(), getTree() })`, mounted at `/api/trees` (Phase 7):
  - `POST /` — body `TreeRequestBody` (`prompt`, optional `maxDepth`) → **202** `StartTreeResponse`. Kickoff only: it sends the root message and returns, so the build never runs inside the request
  - `GET /:runId` — uuid-validated → **200** `TreeResponse` (run status + every known node with its real status + stats; articles from Phase 10)
- `nodes.routes.ts` — `createNodesRouter({ getNode(), boostArticle() })`, mounted at `/api/nodes` (Phase 10; `POST /:nodeId/boost` → 202 `BoostResponse` since 10.10, C128 - no body, no LLM call; auth none until Phase 12, rate limit Phase 11S):
  - `GET /:nodeId` — uuid-validated → **200** `NodeResponse` (the node, its parent, its children, its article and its 3 questions in ONE call). `article: null` = not yet written, `articleFailureReason` = written and lost (C90), `quiz: null` = no credible evidence to cite (C80). There is no `/quiz` route: C74 bundled the questions into the writer's own call, so nothing is generated on demand
- `runs.routes.ts` — `createRunsRouter({ listRuns() })`, mounted at `/api/runs` (Phase 9): `GET /` with an optional `limit` (1..`RUNS_LIST_LIMIT`) → the recent runs the Codex lists, newest first

**Design notes:**
- The read routes never touch AWS: they read the repositories (Postgres from Phase 12).
- Deps are **accessor functions**, not use-case instances: `composition/container.ts` builds the stack on first use, so an unconfigured LLM surfaces as a 503 per request instead of a dead process, and `startTreeBuild()` also restarts a halted worker (docs/conflicts.md C64, C55).
- Express 5 forwards a rejected handler promise to the error middleware, so handlers need no try/catch.
- 202, never 201: the tree does not exist when the response is sent.

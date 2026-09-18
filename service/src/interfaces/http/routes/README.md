# routes/

**Purpose:** One router per resource. Handlers stay a few lines long.

**May depend on:** application/use-cases, domain/schemas, interfaces/http/middleware.

**Must not depend on:** Repositories or agents.

**Planned contents:**
- `trees.routes.ts` — POST /trees, GET /trees/:id
- `topics.routes.ts` — GET /topics/:id
- `agents.routes.ts` — GET /agents (active only); superadmin-guarded POST
- `progress.routes.ts` — POST /progress, GET /progress/:userId

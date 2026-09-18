# use-cases/

**Purpose:** One file per user-facing operation. The API and workers call these; they never call agents or repositories directly.

**May depend on:** domain, application/ports, application/agents, application/graph.

**Must not depend on:** infrastructure, interfaces, HTTP types (no Request/Response).

**Planned contents:**
- `create-tree.use-case.ts` — POST /trees (resolve `config_hash`, reuse existing content or start a run)
- `get-tree.use-case.ts` — GET /trees/:id
- `get-topic.use-case.ts` — article + quiz + ltree navigation
- `list-agents.use-case.ts` — active agents only
- `create-agent.use-case.ts` — superadmin-guarded
- `record-progress.use-case.ts`, `get-progress.use-case.ts` — Tier C

**Design notes:**
- Issue 4: `get-tree` needs a durable run status; Tier A rows disappear after the 48h TTL.

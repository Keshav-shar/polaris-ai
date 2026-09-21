# use-cases/

**Purpose:** One file per operation. Express routes and the queue workers (local worker or Lambda handlers) call these; they never call agents, queues or repositories directly.

**May depend on:** domain, application/ports, application/agents, application/tree, application/graph.

**Must not depend on:** infrastructure, interfaces, HTTP or Lambda types (no Request/Response, no SQSEvent).

**Planned contents:**
- `start-tree-build.use-case.ts` — parse → create run → send root construct message → `{ runId }` (Phase 6)
- `expand-node.use-case.ts` — one node: claim → write its tree row (null brief, so a failed expansion still shows) → reuse or generate + dedup → trim to the run's `MAX_NODES_PER_RUN` budget *before* storing (expectedChildren derives from it) → store → upsert → create, upsertPending and send children. Idempotent; never catches, so the worker can redeliver (Phase 6; C54, C60)
- `handle-dead-letter.use-case.ts` — mark a node's construction or article failed and cascade (Phase 6, article branch Phase 10)
- `get-tree.use-case.ts` — run + nested `TreeNode` + stats; returns EVERY known node with its status and derives `blocked` on a `halted` run, so a build that stopped early still renders (C54); throws `RunNotFoundError` (Phase 6; routed in Phase 7, Postgres from Phase 12)
- `halt-run.use-case.ts` — marks a run `halted` with a readable `haltReason`; wired as the local worker's `onFatal`, so an unrecoverable stall (the LLM daily quota) never leaves a run stuck at `constructing` (Phase 6.1, C55)
- `write-article.use-case.ts` — one article message: claim, reuse or write, store, enqueue children (Phase 10)
- `get-quiz.use-case.ts` — cached quiz for a node, generated on first request (Phase 11)

**Design notes:**
- Every use-case that consumes a message must be idempotent (see the rules in `docs/aws-retrofit.md`).

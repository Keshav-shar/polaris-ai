# use-cases/

**Purpose:** One file per operation. Express routes and the queue workers (local worker or Lambda handlers) call these; they never call agents, queues or repositories directly.

**May depend on:** domain, application/ports, application/agents, application/tree, application/graph.

**Must not depend on:** infrastructure, interfaces, HTTP or Lambda types (no Request/Response, no SQSEvent).

**Planned contents:**
- `start-tree-build.use-case.ts` — parse → create run → send root construct message → `{ runId }` (Phase 6)
- `expand-node.use-case.ts` — one node: claim → write its tree row (null brief, so a failed expansion still shows) → reuse or generate + dedup → trim to the run's `MAX_NODES_PER_RUN` budget *before* storing (expectedChildren derives from it) → store → upsert → create and upsertPending the children → **send this node's own article message** → send the children. The article goes out AFTER the child rows exist (the writer reads them to name the subtopics) and BEFORE the children are queued, which is what makes the two passes overlap (Phase 6; C54, C60, C91)
- `handle-dead-letter.use-case.ts` — mark a node's construction or article failed, record WHY, and cascade. A failed ARTICLE is counted and nothing more: since C91 its children's article messages came from their own expansions, so it cannot strand a subtree (Phase 6, article branch Phase 10, C89 retired by C91, C90)
- `get-tree.use-case.ts` — run + nested `TreeNode` + stats; returns EVERY known node with its status and derives `blocked` on a `halted` run, so a build that stopped early still renders (C54); throws `RunNotFoundError` (Phase 6; routed in Phase 7, Postgres from Phase 12)
- `halt-run.use-case.ts` — marks a run `halted` with a readable `haltReason`; wired as the local worker's `onFatal`, so an unrecoverable stall (the LLM daily quota) never leaves a run stuck at `constructing` (Phase 6.1, C55)
- `write-article.use-case.ts` — built (Phase 10). Claim, reuse the stored draft or (retrieve → credibility
  gate → write), store the article and quiz as two records, count it. It enqueues nothing: construction
  already sent every node's message (C91).
  Mirrors `expand-node.use-case.ts` step for step and NEVER catches, so worker redelivery and the
  dead-letter path still work
- `get-node.use-case.ts` — built (Phase 10). Read model for `GET /api/nodes/:nodeId`: node, parent,
  children, article and quiz in one call. `article: null` = not yet written; `quiz: null` = no evidence
  to cite (C80)
- `list-runs.use-case.ts` — built (Phase 9). Recent runs newest-first for the UI's Codex. Returns the
  run record only: fetching every tree here would turn one page load into an unbounded read
- `get-quiz.use-case.ts` — no longer planned as a separate step: the 3 questions are generated in the
  writer's own call in Phase 10 (docs/conflicts.md C74), so there is no on-demand quiz path

**Design notes:**
- Every use-case that consumes a message must be idempotent (see the rules in `docs/aws-retrofit.md`).

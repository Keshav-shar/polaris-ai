# ports/

**Purpose:** Interfaces (dependency-inversion boundary) that infrastructure implements. Small and role-specific rather than one large repository.

**May depend on:** domain.

**Must not depend on:** Any implementation or SDK type.

**Planned contents:**
- `llm.port.ts` — `LlmPort.chat(messages, { json })`, `ChatMessage` union on `role` (written in Phase 3)
- `node-queue.port.ts` — producer `NodeQueuePort` (`send`, `sendBatch`) plus consumer `NodeQueueConsumerPort` (`receive`, `waitForMessage`, `delete`, `release`, `size`), split so `interfaces/workers` can hold the consumer half without importing an adapter (Phase 6, C53)
- `node-state.port.ts` — `claim`, `saveResult`, `createPending`, `finish`, `recordChildCompletion` (all conditional) (Phase 6); `claimArticle`, `saveArticle` (Phase 10)
- `run-state.port.ts` — run counters (Phase 6); `dedup.port.ts` — `claimTopics(runId, claimantParentId, topics)` (Phase 6, C45)
- `tree-repository.port.ts` (`upsertNode(message, brief | null)`, `upsertPending(messages)`, `setStatus`, `getTree` — every node, no pruning; C54), `run-state.port.ts` (`countNode`, `reserveNodes(runId, requested)` — the `MAX_NODES_PER_RUN` claim, one conditional write; C60), `run-repository.port.ts` (`create`, `setStatus(runId, status, haltReason?)`, `get`, `countActive()` — runs still `constructing`, read by the `MAX_CONCURRENT_RUNS` cost guard; Phase 7, C61) — permanent store (Phase 6 in memory, Phase 12 Postgres)
- `id-generator.port.ts` — `next()`, so run ids are injected randomness (Phase 6, C45d)
- `expansion-cache.port.ts` — `get`/`put` for identical expansion requests (Phase 6, C47)
- `search.port.ts` (Phase 9)
- `article-repository.port.ts` (Phase 10)
- `quiz-store.port.ts` (Phase 11)

**Design notes:**
- Queue and node state start in memory and move to SQS / DynamoDB in Phase 13; repositories move to Postgres in Phase 12. Only `composition/` changes; callers never do.

# ports/

**Purpose:** Interfaces (dependency-inversion boundary) that infrastructure implements. Small and role-specific rather than one large repository.

**May depend on:** domain.

**Must not depend on:** Any implementation or SDK type.

**Planned contents:**
- `llm.port.ts` — `LlmPort.chat(messages, options)`, `ChatMessage` union on `role` (Phase 3). `ChatOptions`: `json`, `responseSchema` (strict structured output), `temperature`, `seed`, `reasoningEffort`, `maxCompletionTokens` (optional; no label sets one, C112), `label`; plus `ReasoningEffort`, `ResponseSchema` and `LlmCallEvent`, the per-request record adapters report (Phase 10.7, C112-C116)
- `rate-window.port.ts` — built (Phase 10.10, A13 early, C130). `tryAcquire(key, limit, nowMs)`: one shared requests/minute count per model, fixed epoch-minute windows, refusal counts nothing; memory now, DynamoDB conditional `ADD` in Phase 13. `ChatOptions.priority` (`ChatPriority { lane, depth }`, C129) is on `llm.port.ts`; `NodeQueuePort.promote(message)` (never a copy) and `NodeStatePort.markBoosted(nodeId)` are the boost's two writes (C128); `StoredNode.path` lets a message be rebuilt from rows.
- `node-queue.port.ts` — producer `NodeQueuePort` (`send`, `sendBatch`) plus consumer `NodeQueueConsumerPort` (`receive`, `waitForMessage`, `delete`, `release`, `size`), split so `interfaces/workers` can hold the consumer half without importing an adapter (Phase 6, C53). `release(id, { countReceive?, delayMs? })` and `QueueReceipt.stallCount` are what let a stall be redelivered without counting and without hot-looping (C94)
- `node-state.port.ts` — `claim`, `saveResult`, `createPending`, `finish`, `recordChildCompletion` (all conditional) (Phase 6); `claimArticle`, `saveArticle`, `finishArticle` — built (Phase 10). `finishArticle` is the article twin of
  `finish` and was not in the original plan: without its conditional terminal transition a late-failing
  redelivery would count `articlesDone` twice (docs/conflicts.md C82)
- `run-state.port.ts` — run counters (Phase 6); `dedup.port.ts` — `claimTopics(runId, claimantParentId, topics)` (Phase 6, C45)
- `tree-repository.port.ts` (`upsertNode(message, brief | null)`, `upsertPending(messages)`, `setStatus`, `getTree` — every node, no pruning; C54), `run-state.port.ts` (`countNode`, `reserveNodes(runId, requested)` — the `MAX_NODES_PER_RUN` claim, one conditional write; C60), `run-repository.port.ts` (`create`, `setStatus(runId, status, haltReason?)`, `get`, `countActive()` — runs still `constructing`, read by the `MAX_CONCURRENT_RUNS` cost guard; Phase 7, C61) — permanent store (Phase 6 in memory, Phase 12 Postgres)
- `id-generator.port.ts` — `next()`, so run ids are injected randomness (Phase 6, C45d)
- `expansion-cache.port.ts` — `get`/`put` for identical expansion requests (Phase 6, C47)
- `evidence-repository.port.ts` — built (Phase 10.9, C123). `replaceForNode(nodeId, records)`, `listForNode(nodeId)`: every source the writer was shown, with query and time; Postgres `evidence` in Phase 12.
- `search.port.ts` — built (Phase 9). `search(query, maxResults, signal?)` → `SearchResult[]`.
  Results are RAW: no credibility field, because scoring is a pure domain rule and an adapter must
  not be able to decide what counts as credible
- `article-repository.port.ts` — built (Phase 10). Upsert by `nodeId` (rule 6) + `get`
- `quiz-store.port.ts` — built (Phase 10), not Phase 11: the questions come from the writer's own call
  (C74). A node may have an article and no quiz, which is legitimate (C80)

**Design notes:**
- Queue and node state start in memory and move to SQS / DynamoDB in Phase 13; repositories move to Postgres in Phase 12. Only `composition/` changes; callers never do.

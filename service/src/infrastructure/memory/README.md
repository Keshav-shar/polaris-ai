# memory/

**Purpose:** In-memory adapters used locally (`QUEUE_MODE=memory`) and in unit tests. Same ports and the same conditional semantics as SQS / DynamoDB / Postgres.

**May depend on:** application/ports, domain.

**Must not depend on:** SDKs, other adapters, use-cases.

**Planned contents:**
- `memory-node-queue.adapter.ts` — FIFO in-process queue with receive counts; implements both halves of `node-queue.port.ts` (Phase 6)
- `memory-node-state.store.ts`, `memory-run-state.store.ts`, `memory-dedup.store.ts` — conditional semantics identical to DynamoDB (Phase 6)
- `memory-tree.repository.ts` (keeps failed nodes and returns real statuses; rows only move forward `pending < expanded < done|failed` — C54), `memory-run.repository.ts` (`countActive` scans for `constructing`; one indexed `count(*)` in Phase 12 — C61), `memory-run-state.store.ts` (holds the `MAX_NODES_PER_RUN` cap so the read and decrement are one step, as a DynamoDB conditional update would be — C60), `memory-expansion-cache.store.ts` (Phase 6), `memory-article.repository.ts` (Phase 10), `memory-quiz.store.ts` (Phase 11)

**Design notes:**
- Naming follows the role-suffix convention in `service/README.md` (`*.adapter.ts`, `*.store.ts`, `*.repository.ts`), not the `in-memory-*` spelling this file used before Phase 6 (docs/conflicts.md C53).
- **Atomicity contract:** every method does its read-modify-write with no `await` between the read and the write, so the single-threaded event loop makes it atomic exactly as a DynamoDB conditional expression is. Adding an `await` inside one of those blocks silently breaks idempotency rule 3 or 5.
- The queue mirrors every SQS condition except the visibility timeout: in-process there is no crashed consumer, and a timer would make the worker tests nondeterministic (C51).
- Tests can make the queue redeliver, duplicate or reorder messages to prove idempotency.
- Postgres replaces the repositories in Phase 12, SQS/DynamoDB replace queue and state in Phase 13, through `composition/`.

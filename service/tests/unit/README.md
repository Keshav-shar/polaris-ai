# unit/

**Purpose:** Fast, deterministic tests with no network. Ports are replaced by in-memory adapters or fakes; AWS SDK clients get a stubbed `send`.

**May depend on:** domain, application, infrastructure (with stubbed clients), interfaces, fixtures.

**Must not depend on:** Real LLMs, real databases, real AWS.

**Planned contents:**
- `shared/words.test.ts`, `domain/schemas/*.test.ts`, `domain/traversal/layer-position.test.ts`, `config/env.test.ts`, `interfaces/http/app.test.ts` (Phase 2)
- `infrastructure/llm/concurrency.test.ts`, `application/llm/structured.test.ts` (Phase 3)
- `application/agents/*.test.ts` — parser mapping, verifier fixtures, guardrail regression (Phases 4, 5, 9)
- `application/use-cases/expand-node.use-case.test.ts`, `application/tree/fan-in.test.ts` — duplicate delivery, out-of-order completion, crash-after-generation reuse, DLQ cascade, dedup, parallelism proof (Phase 6)
- `application/use-cases/{get-tree,handle-dead-letter,start-tree-build,halt-run}.use-case.test.ts`, `application/tree/{construct-node,expansion-cache}.test.ts`, `infrastructure/memory/*.test.ts`, `interfaces/workers/{local-queue-worker,construction-loop}.test.ts` (Phase 6)
- `infrastructure/llm/{rate-limit,openai-compatible.adapter}.test.ts` — errors built through the REAL SDK constructor, because every hand-built plain object missed the `Headers` bug (Phase 6.1, C56)
- `domain/traversal/estimate-expand-calls.test.ts` (Phase 6.1); `composition/llm.test.ts`, `shared/redact.test.ts` (Phase 6.2; the failover adapter and its test were deleted with the second provider in C93)
- `interfaces/http/{trees.routes,trees.routes.flow,validate.middleware}.test.ts`, `composition/container.test.ts`, `infrastructure/memory/memory-run.repository.test.ts` (Phase 7). `trees.routes.test.ts` fakes the use-cases to prove every status mapping; `trees.routes.flow.test.ts` puts the REAL construction stack (`buildHarness`, fake expander) behind the real routes, so POST → poll GET → `constructed` is the offline twin of the phase's curl Verify - including the halted partial tree, the 429 guard and the `MAX_NODES_PER_RUN` cap
- `application/use-cases/write-article.use-case.test.ts` — children NAMED but not taught (and no grandchild topic anywhere in the context - C86), no message enqueued by the writer (C91), idempotency rules 1/2/4/6, run completion (Phase 10, 10.1, 10.3)
- `shared/failure-reason.test.ts`, `domain/schemas/url.schema.test.ts`, `infrastructure/memory/memory-node-queue.adapter.test.ts` (delayed release), `interfaces/workers/local-queue-worker.test.ts` (stall budget) — the C94/C95 surface: what a transport fault costs, and what a hostile url cannot do
- `application/use-cases/get-quiz.use-case.test.ts` — cache hit makes no LLM call, question-count repair (Phase 11)
- `infrastructure/aws/*.test.ts`, `infrastructure/dynamodb/*.test.ts` — request shapes and condition expressions with a stubbed client (Phase 13)

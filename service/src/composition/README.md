# composition/

**Purpose:** The composition roots: the only places that construct adapters and bind them to ports. Swapping in-memory adapters for Postgres (Phase 12) or SQS/DynamoDB (Phase 13) is a change here only.

**May depend on:** Everything.

**Must not depend on:** Being imported by domain, application or infrastructure.

**Planned contents:**
- `secrets.ts` — `secretValues(env)`: every configured secret VALUE, for redaction by value in stored failure reasons and script output; replaced the old LLM-key-only list (C103)
- `search.ts` — `createSearchFromEnv(env)`: the only place a search adapter is built; always wrapped in the bounded cache (10.9, C126). Wikipedia unless
  `SEARCH_PROVIDER=tavily` (Phase 9)
- `llm.ts` — `createLlmFromEnv(env, logger?, onCall?)` (each member gets its `@effort` ceiling, the logger and the usage observer, C113, C116) → `LlmStack` (`llm`, `activeModel()`, `cacheNamespace()`, `dailyRequestBudget`): the only place LLM adapters are built; call once per process so each limiter is shared. Builds the one provider as a single adapter or a rotating model pool (`LLM_MODELS`), plus `writerLlm` - its own pool when `LLM_WRITER_MODELS` names one (C92), the same instance otherwise. There is no second provider to fail over to since C93: the pool is the resilience (Phase 3, C43; pool C68; one provider C93)
  Since 10.10 (C129-C131): one priority limiter and one pacer per model id (`createSharedLimits`), handed to BOTH pools; the requests/minute window is a `RateWindowPort` (memory store by default, an argument so Phase 13 can pass DynamoDB); a single model is a one-member pool. `build-stack.ts` builds both queues with `order: "priority"` and exposes `boostArticle`; `container.ts` adds `boostArticle()` (never starts a worker).
- `build-stack.ts` — the whole build path on `QUEUE_MODE=memory`: memory adapters, agents, node constructor (with the expansion cache), fan-in, the use-cases (`start-tree-build`, `expand-node`, `write-article`, `get-tree`, `get-node`, `list-runs`, `handle-dead-letter`, `halt-run`) and BOTH workers, which run at the same time since C91. The writer gets its own `generateStructured` when `LLM_WRITER_MODELS` names a second pool (C92). Exposes `llmCalls()` (structured calls by label, for the smoke report), `llmUsage()` (provider requests, tokens and time per label, from the adapters' `onCall`, C116), `activeModel()` so callers can report the model that ANSWERED (after a pool rotation) and `cacheNamespace()`, which is what the expansion cache is keyed by - never the answering model (Phase 6; `halt-run` C55, `activeModel` C59, `cacheNamespace` C69)
- `container.ts` — Express: `createContainer(env, logger)` → `ApiContainer` (`llmConfigured`, `startTreeBuild()`, `getTree()`, `shutdown()`). Wraps `build-stack.ts` rather than duplicating it, and builds it **lazily and memoized on success**, because `createLlmFromEnv` throws `EnvError` eagerly and the API's job in that state is to answer 503. `startTreeBuild()` also calls `worker.start()` — idempotent, and it clears a halt so the next run is not stranded at `constructing`; `getTree()` deliberately does not. `QUEUE_MODE=sqs` throws until Phase 13 (Phase 7, C64)
- `worker-container.ts` — Lambda: builds SQS / DynamoDB / Supabase / LLM adapters once per warm container and returns the worker use-cases (Phase 13)

**Design notes:**
- Module-level memoization is allowed here only (warm Lambda containers reuse clients).

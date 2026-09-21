# composition/

**Purpose:** The composition roots: the only places that construct adapters and bind them to ports. Swapping in-memory adapters for Postgres (Phase 12) or SQS/DynamoDB (Phase 13) is a change here only.

**May depend on:** Everything.

**Must not depend on:** Being imported by domain, application or infrastructure.

**Planned contents:**
- `llm.ts` — `createLlmFromEnv(env, logger?)` → `LlmStack` (`llm`, `activeModel()`, `dailyRequestBudget`): the only place LLM adapters are built; call once per process so each limiter is shared. Wires the other profile as a one-way failover target whenever it is complete (Phase 3, C43; failover C59)
- `build-stack.ts` — the construction path on `QUEUE_MODE=memory`: memory adapters, agents, node constructor (with the expansion cache), fan-in, the five use-cases (`start-tree-build`, `expand-node`, `get-tree`, `handle-dead-letter`, `halt-run`) and the local worker. Exposes `activeModel()` so callers can report the model that ANSWERED after a failover (Phase 6; `halt-run` C55, `activeModel` C59)
- `container.ts` — Express: `createContainer(env, logger)` → `ApiContainer` (`llmConfigured`, `startTreeBuild()`, `getTree()`, `shutdown()`). Wraps `build-stack.ts` rather than duplicating it, and builds it **lazily and memoized on success**, because `createLlmFromEnv` throws `EnvError` eagerly and the API's job in that state is to answer 503. `startTreeBuild()` also calls `worker.start()` — idempotent, and it clears a halt so the next run is not stranded at `constructing`; `getTree()` deliberately does not. `QUEUE_MODE=sqs` throws until Phase 13 (Phase 7, C64)
- `worker-container.ts` — Lambda: builds SQS / DynamoDB / Supabase / LLM adapters once per warm container and returns the worker use-cases (Phase 13)

**Design notes:**
- Module-level memoization is allowed here only (warm Lambda containers reuse clients).

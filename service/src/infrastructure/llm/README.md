# llm/

**Purpose:** LLM and embedding adapters for the free-tier OpenAI-compatible provider (Groq since C93) behind `llm.port.ts` (an `embedding.port.ts` is planned only with semantic dedup, Q7).

**May depend on:** application/ports, domain, `openai` SDK.

**Must not depend on:** Prompt content (belongs beside agents).

**Planned contents:**
- `concurrency.ts` — dependency-free `createLimiter(n)` (written in Phase 3)
- `openai-compatible.adapter.ts` — `createOpenAiCompatibleLlm(config, client?, sleep?)`: one client for every provider, config via constructor, limiter per instance, and its OWN retry loop (written in Phase 3; retry loop C50, injected `sleep` for timer-free tests)
- `rate-limit.ts` — `classifyLlmError(error)` → `daily-quota` / `network` / `retryable` / `fatal`, and `bodyRetryAfterMs(body)` for providers that state their wait in the response body rather than a header (Phase 6, C50/C56). `network` is checked FIRST and covers everything that never reached the provider (`APIConnectionError`, `fetch failed`, socket codes on any `cause`): it has no status, so it would otherwise be indistinguishable from a 503 and would be retried against every model and then counted against the node (C94)
- `switchable.ts` — `SwitchableLlm` (`activeModel()` = who answered, reporting only; `cacheNamespace()` = which set of models may answer, stable under rotation) and `fixedModelLlm` for the single-model case. Splitting the two is what stops one pool member's answer being filed under another's cache key (Phase 8.5, C69)
- `model-pool.adapter.ts` — `createModelPoolLlm({ members, policy, maxConcurrency, logger })`: rotates over several models of ONE provider, which share its base URL and key. Groq's limits are per (organization, model), so this multiplies capacity rather than re-hitting one bucket. `round-robin` (the default since C92) starts each call at the next member; `throttle` rotates on a per-minute 429 instead of sleeping; `exhaustion` rotates only on a daily quota. Bounded by `MODEL_POOL.MAX_ATTEMPTS` so rotation multiplies capacity, never cost; one shared limiter keeps `LLM_MAX_CONCURRENCY` process-wide (Phase 8.5, C68)
- `embedding.adapter.ts` (only with semantic dedup; not in the current plan)

**Design notes:**
- The SDK is built with `maxRetries: 0`: the retry loop lives in the adapter, so a 429 is classified BEFORE an attempt is spent on it (C50). A **daily** quota throws `QuotaExhaustedError` on the first attempt; a burst limit backs off, honouring a server-stated wait from the `retry-after` header or the response body (C56). The limiter keeps concurrency inside free-tier rate limits.
- Error shapes cross a trust boundary and are parsed, never cast. Normalise first: the SDK sets `APIError.headers` to a `Headers` instance, which zod rejects, and one rejected field used to fail the whole parse and silently downgrade every daily quota to a retryable one (C56).
- If embeddings are added, their dimension is defined once as `EMBEDDING_DIMENSION` in `config/constants.ts` (not created yet); never hard-code it.

# llm/

**Purpose:** LLM and embedding adapters for free-tier OpenAI-compatible providers (Gemini, Groq, OpenRouter) behind `llm.port.ts` and `embedding.port.ts`.

**May depend on:** application/ports, domain, `openai` SDK.

**Must not depend on:** Prompt content (belongs beside agents).

**Planned contents:**
- `concurrency.ts` — dependency-free `createLimiter(n)` (written in Phase 3)
- `openai-compatible.adapter.ts` — `createOpenAiCompatibleLlm(config, client?, sleep?)`: one client for every provider, config via constructor, limiter per instance, and its OWN retry loop (written in Phase 3; retry loop C50, injected `sleep` for timer-free tests)
- `rate-limit.ts` — `classifyLlmError(error)` → `daily-quota` / `retryable` / `fatal`, and `bodyRetryAfterMs(body)` for providers that state their wait in the response body rather than a header (Phase 6, C50/C56)
- `failover.adapter.ts` — `createFailoverLlm({ primary, fallback, logger })`: one-way, sticky switch to the reserve provider on a daily quota only (Phase 6.2, C59)
- `embedding.adapter.ts` (Phase 13)

**Design notes:**
- The SDK is built with `maxRetries: 0`: the retry loop lives in the adapter, so a 429 is classified BEFORE an attempt is spent on it (C50). A **daily** quota throws `QuotaExhaustedError` on the first attempt; a burst limit backs off, honouring a server-stated wait from the `retry-after` header or the response body (C56). The limiter keeps concurrency inside free-tier rate limits.
- Error shapes cross a trust boundary and are parsed, never cast. Normalise first: the SDK sets `APIError.headers` to a `Headers` instance, which zod rejects, and one rejected field used to fail the whole parse and silently downgrade every daily quota to a retryable one (C56).
- The embedding dimension comes from `EMBEDDING_DIMENSION` in `config/constants.ts`; never hard-code it.

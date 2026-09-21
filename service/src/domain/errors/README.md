# errors/

**Purpose:** Typed domain errors so callers branch on error kind instead of parsing messages.

**May depend on:** Nothing.

**Must not depend on:** HTTP status codes or SDK error types (mapping happens in interfaces/http/middleware).

**Planned contents:**
- `domain-error.ts` — abstract base with a stable `code` (written in Phase 3)
- `structured-output.error.ts` — `StructuredOutputError(label, lastError)`, code `STRUCTURED_OUTPUT_INVALID`: LLM output still invalid after repair attempts (HTTP 502, mapped in Phase 7; written in Phase 3)
- `construction-rejected.error.ts` — `ConstructionRejectedError(reason)`, code `CONSTRUCTION_REJECTED`: verifier rejected an expansion (message fails → redelivery; written in Phase 5)
- `quota-exhausted.error.ts` — `QuotaExhaustedError(model, retryAfterMs?)`, code `QUOTA_EXHAUSTED`: the provider's DAILY quota is gone, so no in-process backoff can outlast it. With a second provider profile configured it fails over one-way instead (C59); when every profile is exhausted the worker halts rather than dead-lettering. **HTTP 429 with `Retry-After`**, mapped in Phase 7 - not 503, which stays for an unconfigured LLM (written in Phase 6; status decided in 6.2)
- `run-not-found.error.ts` — `RunNotFoundError(runId)`, code `RUN_NOT_FOUND` (HTTP 404, mapped in Phase 7; written in Phase 6)
- `run-in-progress.error.ts` — `RunInProgressError(active, limit)`, code `RUN_IN_PROGRESS`: `MAX_CONCURRENT_RUNS` reached, so `POST /api/trees` refuses to start a second build rather than doubling the quota draw. A cost guard, not a failure - it is thrown BEFORE the parser call, so a refusal costs zero LLM requests. **HTTP 429 with `Retry-After`** (written in Phase 7, C61)

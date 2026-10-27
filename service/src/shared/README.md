# shared/

**Purpose:** Small, generic, business-agnostic helpers.

**May depend on:** Standard library only.

**Must not depend on:** Domain concepts. Anything that would need a domain type belongs in domain.

**Planned contents:**
- `words.ts` — `countWords`, `truncateToWords` (Phase 2), `contentWords` (10.9, C124: what groundedness compares)
- `logger.ts` — leveled JSON logging to stdout (CloudWatch in Lambda), reads `LOG_LEVEL`, never logs secrets; not for use in `domain/` (Phase 2)
- `redact.ts` — `redactSecrets(text, secrets)`: strip provider keys from anything about to be printed; pure, so it belongs to no layer (Phase 6.2, C58)
- `failure-reason.ts` — `failureReason(error, secrets?)`: the one readable `name: message` line stored as `Run.haltReason` / `articleFailureReason` and shown instead of a stack trace. Redacted and truncated, because it reaches the API (C90)
- `transport-fault.ts` — `transportFaultCode(error)`: names a transport fault (socket code anywhere in a bounded `cause` chain, or our own `TimeoutError`), undefined otherwise. Shared by the LLM classifier and the search adapters (Phase 10.7, C115)
- `ids.ts` — generic `uuidV5(name, namespace)`, `sha256Hex(value)`, `randomUuid()` on `node:crypto` (written in Phase 5); node-id composition is in `application/tree/node-ids.ts`
- `result.ts` — Result helper for expected failures (when first needed)

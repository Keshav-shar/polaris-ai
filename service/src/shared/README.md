# shared/

**Purpose:** Small, generic, business-agnostic helpers.

**May depend on:** Standard library only.

**Must not depend on:** Domain concepts. Anything that would need a domain type belongs in domain.

**Planned contents:**
- `words.ts` — `countWords`, `truncateToWords` (Phase 2)
- `logger.ts` — leveled JSON logging to stdout (CloudWatch in Lambda), reads `LOG_LEVEL`, never logs secrets; not for use in `domain/` (Phase 2)
- `redact.ts` — `redactSecrets(text, secrets)`: strip provider keys from anything about to be printed; pure, so it belongs to no layer (Phase 6.2, C58)
- `ids.ts` — generic `uuidV5(name, namespace)`, `sha256Hex(value)`, `randomUuid()` on `node:crypto` (written in Phase 5); node-id composition is in `application/tree/node-ids.ts`
- `result.ts` — Result helper for expected failures (when first needed)

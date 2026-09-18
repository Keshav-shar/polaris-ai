# shared/

**Purpose:** Small, generic, business-agnostic helpers.

**May depend on:** Standard library only.

**Must not depend on:** Domain concepts. Anything that would need a domain type belongs in domain.

**Planned contents:**
- `result.ts` — Result/Either helper for expected failures
- `logger.ts` — structured JSON logging to stdout (CloudWatch); not for use in `domain/`
- `hash.ts` — stable hashing for `config_hash`

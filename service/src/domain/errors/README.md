# errors/

**Purpose:** Typed domain errors so callers branch on error kind instead of parsing messages.

**May depend on:** Nothing.

**Must not depend on:** HTTP status codes or SDK error types (mapping happens in interfaces/http/middleware).

**Planned contents:**
- `domain-error.ts` — base class with a stable `code`
- `guardrail-rejected.error.ts`, `invalid-traversal-plan.error.ts`, `invalid-topic-path.error.ts`

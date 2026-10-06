# middleware/

**Purpose:** Cross-cutting HTTP concerns.

**May depend on:** domain/errors, domain/schemas, shared, `config/constants` and the `EnvError` type from `config/env` (the class only — never `getEnv()`).

**Must not depend on:** Business logic.

**Contents:**
- `error-handler.middleware.ts` — **the only place errors become status codes** (Phase 2, extended in Phase 7):

  | Error | Status | wire `code` | Header |
  |---|---|---|---|
  | malformed JSON body | 400 | `invalid_json` | — |
  | body over 10 kb | 413 | `payload_too_large` | — |
  | `ZodError` | 400 | `invalid_request` (+ `issues`) | — |
  | `RunNotFoundError` | 404 | `run_not_found` | — |
  | `NodeNotFoundError` | 404 | `node_not_found` | — |
  | `RunInProgressError` | 429 | `run_in_progress` | `Retry-After` |
  | `QuotaExhaustedError` | 429 | `quota_exhausted` | `Retry-After` (provider's own wait when stated) |
  | `StructuredOutputError` | 502 | `structured_output_invalid` | — |
  | `TransportUnavailableError` | 503 | `transport_unavailable` (fixed sentence; diagnosis only in logs, C95) | `Retry-After` |
  | `EnvError` | 503 | `llm_not_configured` | — |
  | anything else | 500 | `internal` (generic; details only in logs) | — |

- `validate.middleware.ts` — `validateBody(schema)` / `validateParams(schema)` → `{ middleware, read(res) }` (Phase 7). The pair is what makes the parsed value typed in the handler without a second parse: the middleware stores it on `res.locals` under a key private to that validator, and `read` returns it. A failure goes to `next(ZodError)`, so this file maps nothing itself
- (later) `auth.middleware.ts` — only when an auth model is decided

**Design notes:**
- Wire codes are lower_snake (`run_not_found`), while `DomainError.code` is UPPER_SNAKE (`RUN_NOT_FOUND`): the HTTP vocabulary is deliberately its own, so renaming a domain error never silently changes the API.
- Express 5 exposes `req.params` through a getter and leaves `req.body` untyped, which is why the parsed value goes to `res.locals` rather than overwriting the request.

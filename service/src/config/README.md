# config/

**Purpose:** Constants and validated environment configuration.

**May depend on:** zod.

**Must not depend on:** Anything else. `constants.ts` is pure data and may be imported by any layer; `env.ts` reads `process.env` and is imported only by `composition/`.

**Planned contents:**
- `constants.ts` — `QUIZ_CONFIG` (QUESTIONS_PER_TOPIC 5, PASSING_SCORE_PERCENT 70, MAX_GUARDRAIL_RETRIES 2), ephemeral TTL (48h), embedding dimension
- `env.ts` — Zod-parsed environment; fail fast at cold start

**Design notes:**
- Issue 6: define the embedding dimension once here and reference it from both SQL migration notes and the embedding adapter.

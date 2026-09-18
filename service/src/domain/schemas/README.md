# schemas/

**Purpose:** Zod schemas that validate data crossing a trust boundary (LLM output, request bodies, DB JSON columns). Types are inferred with `z.infer` so schema and type cannot drift.

**May depend on:** zod, domain/entities.

**Must not depend on:** Anything with I/O.

**Planned contents:**
- `prompt-schema.ts` — Parser agent output `{ topic, maxlen }`
- `agent-schema.ts` — `TeachingAgent` and `TraversalPhase` validation (min <= max depth, ratio in 0..1, max depth <= maxTreeHeight)
- `quiz-schema.ts` — question shape; length must equal `QUIZ_CONFIG.QUESTIONS_PER_TOPIC`

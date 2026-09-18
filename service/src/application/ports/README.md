# ports/

**Purpose:** Interfaces (dependency-inversion boundary) that infrastructure implements. Small and role-specific rather than one large repository.

**May depend on:** domain.

**Must not depend on:** Any implementation or SDK type.

**Planned contents:**
- `teaching-agent-repository.port.ts`, `topic-repository.port.ts`, `evidence-repository.port.ts` — Tier B
- `tree-node-store.port.ts` — Tier A (ephemeral)
- `progress-repository.port.ts` — Tier C
- `llm.port.ts`, `embedding.port.ts`, `search.port.ts`
- `metrics.port.ts`, `secrets.port.ts`, `clock.port.ts`

**Design notes:**
- Tier A being in-memory first, then DynamoDB (plan section 8, steps 4 and 7) is exactly why `tree-node-store.port.ts` exists: swap the adapter, not the callers.

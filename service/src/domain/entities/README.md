# entities/

**Purpose:** Domain types for the three storage tiers and the teaching model. Types plus small invariant-enforcing helpers only.

**May depend on:** domain/schemas, domain/errors.

**Must not depend on:** Any persistence or transport concern (no SQL rows, no DynamoDB attribute maps).

**Planned contents:**
- `teaching-agent.ts` — id, name, personalityMd, traversalPlan, maxTreeHeight, extraControllers, isActive
- `tree-node.ts` — Tier A working node: parent, depth, breadthIndex, status (pending | expanding | guardrail_pass | guardrail_fail | committed), retryCount
- `tree-run.ts` — run id, config, status
- `topic.ts` — Tier B committed topic, ltree path, depth
- `evidence.ts`, `article.ts`, `quiz.ts`
- `user-topic-progress.ts` — Tier C: timeSpentSeconds, quizScore, agentIdUsed, configId, completedAt

**Design notes:**
- Issue 2: model the ltree `path` as a value object that validates label characters and length, so an invalid path cannot be constructed.

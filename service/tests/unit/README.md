# unit/

**Purpose:** Fast, deterministic tests with no network. Ports are replaced by fakes.

**May depend on:** domain, application, fixtures.

**Must not depend on:** Real LLMs, real databases.

**Planned contents:**
- `domain/traversal/traversal-engine.test.ts` — BFS/DFS/Custom against fake nodes; prove correctness before any agent exists (plan step 2)
- `application/agents/guardrail.agent.test.ts` — regression tests on the highest-risk layer

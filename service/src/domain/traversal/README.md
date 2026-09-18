# traversal/

**Purpose:** The traversal engine (plan section 2). The only thing that varies between BFS, DFS and Custom is a TraversalPlan, so the engine is closed for modification and open for extension.

**May depend on:** domain/entities, domain/errors.

**Must not depend on:** Agents, LLMs, databases, the graph. The engine must run against fake nodes with zero I/O.

**Planned contents:**
- `traversal-phase.ts` — `TraversalPhase` type, pure data, no logic
- `traversal-plan.ts` — `BFS_PLAN`, `DFS_PLAN`, `makeCustomPlan(introDepth, maxHeight)`
- `traversal-engine.ts` — priority-queue executor; reads any plan; never edited to add a plan
- `priority-queue.ts` — generic PQ wrapper (tinyqueue)

**Design notes:**
- `priority(node) = (1 - ratio) * breadthScore + ratio * depthScore`. `maxTreeHeight` is a hard ceiling checked BEFORE priority is computed; it caps depth only, never breadth.
- Extension rule: a new controller is one more optional key on `TraversalPhase` plus one more read inside `priority()`. Plan definitions and the executor loop stay untouched.

# graph/

**Purpose:** LangGraph.js wiring only: nodes, edges and state type. No business rules; those live in agents and the traversal engine.

**May depend on:** domain, application/agents, application/ports.

**Must not depend on:** infrastructure.

**Planned contents:**
- `polaris-graph.ts` — state graph wiring agents + traversal engine
- `graph-state.ts` — state type and reducers

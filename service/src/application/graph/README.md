# graph/

**Purpose:** LangGraph.js wiring only: nodes, edges and state type. No business rules; those live in agents and use-cases.

**May depend on:** domain, application/agents, application/ports.

**Must not depend on:** infrastructure.

**Planned contents:**
- `node-subgraph.ts` — optional LangGraph wrapper around one node's construction step (expand → verify) or article step (retrieve → guardrail → write)

**Design notes:**
- **Not yet adopted (C98):** `@langchain/langgraph` is not a dependency and the queue + use-cases do the orchestrating; the use-cases call the agents directly. If added, it wraps the same functions, and the Lambda handlers do not change.

# agents/

**Purpose:** The six pipeline agents. Each is a class/function taking its ports by constructor injection and returning validated data.

**May depend on:** domain, application/ports.

**Must not depend on:** Other agents directly (the graph wires them), infrastructure.

**Planned contents:**
- `parser.agent.ts` — prompt to `{topic, maxlen}`, Zod-validated
- `expand.agent.ts` — node to candidate subtopics
- `retrieval.agent.ts` — candidate to scored evidence
- `guardrail.agent.ts` — credibility + groundedness + relevance (highest-risk layer; regression-tested)
- `writer.agent.ts` — committed node to article, evidence-only, personality-aware
- `quiz.agent.ts` — article to quiz, shape from constants
- `*.prompt.ts` — prompt templates kept next to the agent that uses them, versioned

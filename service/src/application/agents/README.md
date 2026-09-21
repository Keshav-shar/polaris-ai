# agents/

**Purpose:** The pipeline agents. Each is a factory taking its ports and returning validated data. Prompts live beside the agent.

**May depend on:** domain, application/ports, application/llm.

**Must not depend on:** Other agents directly (the tree passes / graph wire them), infrastructure.

**Planned contents:**
- `parser.agent.ts` + `parser.prompt.ts` — prompt → `{ topic, maxDepth }`; user text only inside a `<user_request>` data block; falls back to the trimmed prompt on any LLM failure (written in Phase 4)
- `data-block.prompt.ts` — `dataBlock(tag, text)`: the delimited data block every prompt uses for untrusted text (written in Phase 5)
- `expand.agent.ts` + `expand.prompt.ts` — node + context snippet → `{ brief, children }`; never states the children cap (written in Phase 5)
- `verifier.agent.ts` — pure construction verifier: brief, dedupe, cycle guard, leaf rule; no cap (written in Phase 5)
- `consolidator.agent.ts` + `consolidator.prompt.ts` — over `EXPAND.MAX_CHILDREN` only: merge / drop / rank to ≤ 15 (written in Phase 5, C46)
- `retrieval.agent.ts` — node → deduped, scored sources (Phase 9)
- `guardrail.agent.ts` — `assessCredibility` / `checkCredibility`; groundedness stubbed (Phase 9; highest-risk layer, regression-tested)
- `writer.agent.ts` + `writer.prompt.ts` — node brief + parent brief + evidence → article, children withheld (Phase 10)
- `quiz.agent.ts` + `quiz.prompt.ts` — stored article + evidence → `QuizOutput`, shape from `QUIZ_CONFIG`, on demand (Phase 11)

**Design notes:**
- Construction agents never call retrieval; evidence belongs to the article pass (`docs/conflicts.md` C05).

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
- `retrieval.agent.ts` — built (Phase 9). `createRetrievalAgent({ search })`: topic + parent topic →
  query → dedupe by canonical URL → `scoreSource` → `EvidenceItem[]`, best first, capped at
  `RETRIEVAL.MAX_RESULTS`. No LLM call; the one external call per node in the article pass is its search
- `guardrail.agent.ts` — built (Phase 9). `assessCredibility` / `checkCredibility` gate on
  `CREDIBILITY` and **never throw and never drop a node** — a failure marks the article unverified.
  `checkGroundedness()` is an explicit stub returning `skipped` (not `pass`), so its replacement
  finds no caller already treating it as a green light. Highest-risk layer, regression-tested
- `writer.agent.ts` + `writer.prompt.ts` — built (Phase 10). `ArticleContext` → `WriterOutput`: the article AND its
  `QUIZ_CONFIG.QUESTIONS_PER_TOPIC` questions in ONE call (C74), sized by the node's own band rather than a
  sitewide cap (C85). Children are NAMED but never taught — `{topic}` each, strictObject, so a
  child's brief, article or own children cannot reach the writer (C86, C91) — and
  the agent drops any citation or `evidenceUrl` the node was not given, because an invented source makes
  an unsupported claim look grounded
- ~~`quiz.agent.ts` + `quiz.prompt.ts`~~ — **not being built.** C74 moved the questions into the writer's
  own call, so there is no separate quiz agent and no on-demand generation

**Design notes:**
- Construction agents never call retrieval; evidence belongs to the article pass (`docs/conflicts.md` C05).

# agents/

**Purpose:** The pipeline agents. Each is a factory taking its ports and returning validated data. Prompts live beside the agent.

**May depend on:** domain, application/ports, application/llm.

**Must not depend on:** Other agents directly (the tree passes / graph wire them), infrastructure.

**Planned contents:**
- ~~`parser.agent.ts` + `parser.prompt.ts`~~ — **deleted (C100).** Depth comes from the body or a pure regex
  (`domain/traversal/depth-hint.ts`); the root expansion names the topic
- `data-block.prompt.ts` — `dataBlock(tag, text)`: the delimited data block every prompt uses for untrusted text; strips every variant of the tag (written in Phase 5, hardened C103)
- `expand.agent.ts` + `expand.prompt.ts` — interior: node + its parent-written brief + context snippet → `{ children: [{ topic, brief }] }`; root (`request` set): the learner's request inside `<user_request>` → `{ topic, brief, children }`, label `expand-root`. Never states the children cap (Phase 5; reshaped C99, C100)
- `verifier.agent.ts` — pure construction verifier: root topic + brief, dedupe, cycle guard, per-child topic and brief (an invalid child is dropped and counted); no cap (Phase 5; C99)
- ~~`consolidator.agent.ts` + `consolidator.prompt.ts`~~ — **deleted (C101).** Over-long lists are cut in teaching order under the balanced branch cap
- `retrieval.agent.ts` — built (Phase 9). `createRetrievalAgent({ search })`: topic + parent topic →
  query → dedupe by canonical URL → `scoreSource` → `EvidenceItem[]`, best first, capped at
  `RETRIEVAL.MAX_RESULTS`. No LLM call; the one external call per node in the article pass is its search
- `guardrail.agent.ts` — built (Phase 9). `assessCredibility` / `checkCredibility` gate on
  `CREDIBILITY` and **never throw and never drop a node** — a failure marks the article unverified.
  Since 10.9 also the article guard: `assessGroundedness` (each citation's claim vs ITS source, lexical,
  numbers must match, C124), `checkQuizSanity` (C125) and `guardArticle`, which drops ungrounded citations and a
  broken quiz and never edits article text. All pure. Highest-risk layer, regression-tested
- `writer.agent.ts` + `writer.prompt.ts` — built (Phase 10). `ArticleContext` → `WriterOutput`: the article AND its
  `QUIZ_CONFIG.QUESTIONS_PER_TOPIC` questions in ONE call (C74), sized by the node's own band rather than a
  sitewide cap (C85). Children are NAMED but never taught — `{topic, brief}` each (the brief the parent's
  own call wrote, C99/C102), strictObject, so a child's article, evidence or own children cannot reach the
  writer (C86) — and
  the agent drops any citation or `evidenceUrl` the node was not given, because an invented source makes
  an unsupported claim look grounded
- ~~`quiz.agent.ts` + `quiz.prompt.ts`~~ — **not being built.** C74 moved the questions into the writer's
  own call, so there is no separate quiz agent and no on-demand generation

**Design notes:**
- Construction agents never call retrieval; evidence belongs to the article pass (`docs/conflicts.md` C05).

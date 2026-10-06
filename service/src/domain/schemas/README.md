# schemas/

**Purpose:** Zod schemas that validate data crossing a trust boundary (LLM output, request bodies, queue messages, DynamoDB items, DB JSON columns). Types are inferred with `z.infer` so schema and type cannot drift.

**May depend on:** zod, `config/constants`, `shared/words.ts`.

**Must not depend on:** Anything with I/O.

**Planned contents:**
All written in Phase 2 (schema first):
- `node.schema.ts` — `ParsedRequest {topic, maxDepth}`, `LayerPosition`, `AncestorRef`, `NodeContext`, `Brief`, `ExpandOutput {brief, children}`, `TreeNodeStatus`, `TreeNode` (every node is returned, whatever its status; `blocked` is derived by the read model, never stored — C54)
- `queue-message.schema.ts` — `NodeMessage { pass, runId, nodeId, parentId, topic, depth, maxDepth, path, ancestors }` (both queues, both DLQs)
- `node-state.schema.ts` — `NodeStatus`, `NodeState`, `RunState` (in-flight state; DynamoDB item shape)
- `api.schema.ts` — `HealthResponse`, `ApiError`, `TreeRequestBody` (`prompt`, plus an optional `maxDepth` cap added in Phase 7 — it only ever lowers cost; the hard ceiling stays `MAX_NODES_PER_RUN`, which no request can raise; C62), `RunIdParams` (Phase 7), `StartTreeResponse`, `TreeResponse` (re-exports `RunStatus`)
- `run.schema.ts` — `RunStatus` (incl. `halted`), `Run {runId, topic, maxDepth, status, haltReason?}`: the durable run record (Phase 6, C52; `halted` added in 6.1, C55)
- `agent-io.schema.ts` — `RawParserOutput`, `ConsolidatorOutput` (Phase 5, C46)
- `url.schema.ts` — `HttpUrl`: `z.url()` restricted to http(s). Every field that becomes a clickable `href` uses it, because the WHATWG parser `z.url()` validates with accepts `javascript:alert(1)` as well-formed, and these urls come from a search provider through a model (C95)
- `evidence.schema.ts` — `EvidenceItem {url: HttpUrl, title, snippet, credibility}` (used from Phase 9)
- `article.schema.ts` — `ArticleContext` (children as `{topic}` only, each a strictObject so a child's brief, article or own children cannot be smuggled in - C86 as amended by C91), `ArticleOutput` (capped by the `ARTICLE.MAX_WORDS` guard, not a target - C85), `Article`, `WriterOutput` (used from Phase 10)
- `quiz.schema.ts` — `QuizQuestion`, `QuizOutput` (length === `QUIZ_CONFIG.QUESTIONS_PER_TOPIC`), `Quiz` (used from Phase 10, C74)

**Design notes:**
- Every later phase consumes these; a contract change is a logged deviation.
- **Relative imports only** here and in anything these files import (`config/constants`, `shared/words`): `ui/` type-checks these files, and in `ui` the `@/` alias points at `ui/src` (`docs/conflicts.md` C41).
- The UI imports these types (type-only) through `ui/src/lib/contract.ts`; keep them free of server-only imports.

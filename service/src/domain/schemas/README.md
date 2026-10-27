# schemas/

**Purpose:** Zod schemas that validate data crossing a trust boundary (LLM output, request bodies, queue messages, DynamoDB items, DB JSON columns). Types are inferred with `z.infer` so schema and type cannot drift.

**May depend on:** zod, `config/constants`, `shared/words.ts`.

**Must not depend on:** Anything with I/O.

**Planned contents:**
All written in Phase 2 (schema first):
- `node.schema.ts` — `LayerPosition`, `AncestorRef`, `NodeContext`, `Brief`, `Topic` (bounded by `TOPIC_MAX_CHARS`), `ChildDraft {topic, brief}`, `ExpandOutput {children: {topic, brief}[]}` and `RootExpandOutput {topic, brief, children}` (raw replies, lenient per child; C99, C100), `RawExpansion`, `Expansion` (verified), `TreeNodeStatus`, `TreeNode` (every node is returned, whatever its status; `blocked` is derived by the read model, never stored — C54). `ParsedRequest` was deleted with the parser (C100)
- `queue-message.schema.ts` — `NodeMessage { pass, runId, nodeId, parentId, topic, depth, maxDepth, path, ancestors, brief?, request?, boost? }` (`boost`: order only, never what the handler does, C128) (both queues, both DLQs). `brief` = the node's own brief, written by its parent (C99); `request` = the raw prompt, root construct message only (C100)
- `node-state.schema.ts` — `NodeStatus`, `NodeState` (`result: { topic?, brief, children: ChildDraft[] }`, C99/C100), `RunState` (in-flight state; DynamoDB item shape)
- `api.schema.ts` — `HealthResponse`, `ApiError`, `TreeRequestBody` (`prompt`, plus an optional `maxDepth` added in Phase 7 — omitted = a depth stated in the prompt, else the default; the hard ceiling stays `MAX_NODES_PER_RUN`, which no request can raise; C62, C100), `RunIdParams` (Phase 7), `StartTreeResponse`, `TreeResponse` (re-exports `RunStatus`)
  Since 10.10: `BoostStatus`, `BoostResponse` for `POST /api/nodes/:nodeId/boost` (C128). `NodeState.boosted` (node-state.schema.ts) records a boost made before the node's article message existed.
- `run.schema.ts` — `RunStatus` (incl. `halted`), `Run {runId, topic, maxDepth, status, haltReason?}`: the durable run record (Phase 6, C52; `halted` added in 6.1, C55)
- `url.schema.ts` — `HttpUrl`: `z.url()` restricted to http(s). Every field that becomes a clickable `href` uses it, because the WHATWG parser `z.url()` validates with accepts `javascript:alert(1)` as well-formed, and these urls come from a search provider through a model (C95)
- `evidence.schema.ts` — `EvidenceItem {url: HttpUrl, title, snippet, credibility}` (used from Phase 9)
- `article.schema.ts` — `ArticleContext` (children as `{topic, brief}`, each a strictObject so a child's article, evidence or own children cannot be smuggled in - C86, C91, restored by C102), `ArticleOutput` (capped by the `ARTICLE.MAX_WORDS` guard, not a target - C85), `Article`, `WriterOutput` (used from Phase 10), `ArticleDraft` = `WriterOutput` + `credibilityVerified`, the stored draft (Phase 10.7, C118)
- `quiz.schema.ts` — `QuizQuestion`, `QuizOutput` (length === `QUIZ_CONFIG.QUESTIONS_PER_TOPIC`), `Quiz` (used from Phase 10, C74)

**Design notes:**
- Every later phase consumes these; a contract change is a logged deviation.
- **Relative imports only** here and in anything these files import (`config/constants`, `shared/words`): `ui/` type-checks these files, and in `ui` the `@/` alias points at `ui/src` (`docs/conflicts.md` C41).
- The UI imports these types (type-only) through `ui/src/lib/contract.ts`; keep them free of server-only imports.

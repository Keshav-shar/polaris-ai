# tree/

**Purpose:** Tree-level logic shared by the use-cases: the per-request context snippet and the fan-in completion cascade.

**May depend on:** domain (schemas, errors, traversal), application ports, `config/constants`, shared.

**Must not depend on:** `infrastructure`, `interfaces`.

**Planned contents:**
- `context-snippet.ts` — `buildContextSnippet(ctx)`; instruction text per position (`taper` = the children are the final layer); never carries model-written text (Phase 5; C99, C103)
- `node-ids.ts` — `rootNodeId`, `childNodeId` (deterministic UUIDv5) (written in Phase 5)
- `seed.ts` — `seedFor(key)`: stable 32-bit seed per node (C47)
- `construct-node.ts` — `createNodeConstructor({ expand, verify, logger, cache? })`: ONE expand call, verify, cut to `EXPAND.MAX_CHILDREN` in teaching order; agents are injected, never imported (Phase 5; no consolidator since C101)
- `fan-in.ts` — `completeConstruction(nodeId, outcome)` and `completeArticle(runId, nodeId, outcome)`: conditional finish, record in parent, ripple upward; root done → run `constructed`. Pure accounting: since
  C91 it hands nothing to the article pass (each expanded node sends its own message), so it holds no
  queue at all. The run reaches `done` only when it is `constructed` AND every constructed node's article
  is accounted for - checked from both ends, because articles land while `nodesDone` is still climbing.
  `completeArticle` goes through `finishArticle` so it is exactly-once (C82). Built in Phases 6, 10, 10.3
- `messages.ts` — `rootConstructMessage`, `childConstructMessage` (deterministic child ids + the ancestor Since C99/C100 the root message carries the raw `request` and a child message carries its parent-written `brief`; `toArticleMessage` drops `request`.
  window) and `toArticleMessage`, the construct message re-stamped `pass: "article"` that `expand-node`
  sends for the node it just expanded (C91)
  `rebuildMessage(pass, node, lineage, maxDepth)` (Phase 10.10, C128): the same message rebuilt from stored rows, for the boost use-case; proven equal to what construction sent over a depth-3 tree. Never rebuilds the root's raw request.
- `expansion-cache.ts` — `createExpansionCacheDep({ cache, namespace })`: the key is derived from the
  prompt inputs and a NAMESPACE, never the answering model, so a rotating pool cannot file one member's
  answer under another's (C69)

**Design notes:**
- There is no level-synchronous builder any more: fan-out is one queue message per child and fan-in is these counters (`docs/conflicts.md` C39).
- Dependencies are injected so everything is tested with in-memory adapters and no network.

# tree/

**Purpose:** Tree-level logic shared by the use-cases: the per-request context snippet and the fan-in completion cascade.

**May depend on:** domain (schemas, errors, traversal), application ports, `config/constants`, shared.

**Must not depend on:** `infrastructure`, `interfaces`.

**Planned contents:**
- `context-snippet.ts` — `buildContextSnippet(ctx)`; text per position fixed by the spec (written in Phase 5)
- `node-ids.ts` — `rootNodeId`, `childNodeId` (deterministic UUIDv5) (written in Phase 5)
- `seed.ts` — `seedFor(key)`: stable 32-bit seed per node (C47)
- `construct-node.ts` — `createNodeConstructor({ expand, verify, consolidate, logger })`; agents are injected, never imported (written in Phase 5, C46)
- `fan-in.ts` — `completeConstruction(nodeId, outcome)` and `completeArticle(runId, nodeId, outcome)`: conditional finish, record in parent, ripple upward; root done → run `constructed` + root article message; all articles counted → run `done` (Phases 6 and 10)

**Design notes:**
- There is no level-synchronous builder any more: fan-out is one queue message per child and fan-in is these counters (`docs/conflicts.md` C39).
- Dependencies are injected so everything is tested with in-memory adapters and no network.

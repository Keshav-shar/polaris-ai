# entities/

**Purpose:** Domain types for runs, tree nodes, evidence and articles. Types plus small invariant-enforcing helpers only.

**May depend on:** domain/schemas, domain/errors.

**Must not depend on:** Any persistence or transport concern (no SQL rows).

**Planned contents:**
- `tree-run.ts` — id, topic, maxDepth, status (`constructing` | `constructed` | `done` | `failed` | `halted`), haltReason, stats — mirror `domain/schemas/run.schema.ts` (C55)
- `tree-node.ts` — id, parentId, depth, topic, brief, status (`pending` | `expanded` | `done` | `failed`), attempts — the API adds a derived `blocked` (C54)
- `node-path.ts` — ltree path value object built from node ids
- `evidence.ts`, `article.ts`, `quiz.ts`

**Design notes:**
- ltree labels allow only `[A-Za-z0-9_-]`, max 1000 chars: `node-path.ts` builds labels from ids so an invalid path cannot be constructed.
- Teaching/traversal agents and per-user progress are deferred (`docs/conflicts.md` C30).

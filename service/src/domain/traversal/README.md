# traversal/

**Purpose:** Pure rules for the fixed-height, queue-driven BFS construction: where a node sits relative to the bottom of the tree.

**May depend on:** `config/constants`, domain/schemas, domain/errors.

**Must not depend on:** Agents, LLMs, databases, the graph. Everything here runs with zero I/O.

**Planned contents:**
- `layer-position.ts` — `layerPosition(depth, maxDepth)` → `normal` | `taper` | `leaf` (Phase 2)
- `estimate-expand-calls.ts` — `estimateExpandCalls(maxDepth, branching?)`: expand calls a tree would cost, for the pre-build free-tier warning. Warning only, never a cap (Phase 6.1, C57)
- `ancestor-window.ts` — `nextAncestors(ancestors, parent)` keeping the last `ANCESTOR_WINDOW` levels (written in Phase 5)
- `node-id.ts` — `normalizeTopic`, `pathLabel` (`n_` + hex id, ltree-safe), `childPath` (written in Phase 5)
- `clean-children.ts` — `cleanChildren(children, blocked)`: trim, dedupe, cycle guard (written in Phase 5)

**Design notes:**
- Construction is always BFS in causal order (a child is enqueued after its parent finishes; no level barrier, `docs/traversal-algorithm.md`). The v2 priority-queue engine with BFS/DFS/Custom plans is superseded; see `docs/conflicts.md` C02 and C30 (deferred).
- `TAPER_LAYERS = 2` counts the last two layers **including** the leaf: `depth === maxDepth - 1` → taper, `depth === maxDepth` → leaf (zero children). E.g. maxDepth 5 → 0-3 normal, 4 taper, 5 leaf.

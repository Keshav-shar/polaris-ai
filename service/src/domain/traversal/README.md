# traversal/

**Purpose:** Pure rules for the fixed-height, queue-driven BFS construction: where a node sits relative to the bottom of the tree.

**May depend on:** `config/constants`, domain/schemas, domain/errors.

**Must not depend on:** Agents, LLMs, databases, the graph. Everything here runs with zero I/O.

**Planned contents:**
- `article-budget.ts` — `articleBudget(writableChildCount)`: the word band an article aims for, derived from
  how many children the node hands detail down to. The only place article length policy lives, and pure, so
  the policy can be reasoned about and tested without running a model (Phase 10.1, C85)
- `layer-position.ts` — `layerPosition(depth, maxDepth)` → `normal` | `taper` | `leaf` (Phase 2)
- `estimate-calls.ts` — `estimateCalls(maxDepth, { branching?, maxNodes? })`: `{ nodes, expandCalls, writerCalls, total }` a tree would cost (one expand per interior node, one writer per node), for the pre-build free-tier warning. Warning only, never a cap (Phase 6.1 as an expand-only estimate, C57; reshaped in 10.8)
- `branch-cap.ts` — `branchCap(maxNodes, maxDepth)`, `fullTreeSize(b, maxDepth)`: the balanced per-node child cap that spreads `MAX_NODES_PER_RUN` evenly so every branch reaches full depth (Phase 10.8, C101)
- `depth-hint.ts` — `parseDepthHint(request)`: a depth the prompt states, clamped, or undefined (Phase 10.8, C100)
- `ancestor-window.ts` — `nextAncestors(ancestors, parent)` keeping the last `ANCESTOR_WINDOW` levels (written in Phase 5)
- `node-id.ts` — `normalizeTopic`, `pathLabel` (`n_` + hex id, ltree-safe), `childPath` (written in Phase 5)
- `clean-children.ts` — `cleanChildren(children, blocked)`: trim, dedupe, cycle guard; generic over `{ topic }` items so a child's brief travels with it (Phase 5; C99)

**Design notes:**
- Construction is always BFS in causal order (a child is enqueued after its parent finishes; no level barrier, `docs/traversal-algorithm.md`). The v2 priority-queue engine with BFS/DFS/Custom plans is superseded; see `docs/conflicts.md` C02 and C30 (deferred).
- `TAPER_LAYERS = 2` counts the last two layers **including** the leaf: `depth === maxDepth - 1` → taper, `depth === maxDepth` → leaf (zero children). Since C99 a leaf is never expanded: its parent (the taper node) writes it, so `leaf` only matters for a stray message. E.g. maxDepth 5 → 0-3 normal, 4 taper, 5 leaf.

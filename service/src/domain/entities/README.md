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

**Built (Phase 12):**
- `run-access.ts` — `canReadRun(run, caller)` (owner, or a non-private run, or an ownerless auth-off run) and
  `isRunOwner(run, caller)`: the ONE read/ownership rule (C105). Failing it answers 404, never 403
- `run-stats.ts` — `statsOf(runState)`: the five counters copied onto `runs.stats` at a terminal transition (C107)

**Phase C (C106, C139):** `quiz-scoring.ts` (`scoreAttempt`, `publicQuiz` - the answer key leaves only in an
attempt's response) and `learner-signals.ts` (`summarizeSignals`, `hasNewSignals` - counts only, the insight call's
whole input).

**Phase 13 (A19):** `tree-stats.ts` (`statsFromTree`) - run counters from the stored rows when no run state is
reachable.

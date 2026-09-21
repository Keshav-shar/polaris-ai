# scripts/

**Purpose:** Manual smoke scripts and build scripts. Run from `service/`. Smoke scripts are not part of the test suite and never run in CI.

**May depend on:** Anything under `src/`, including `composition/` and `config/env.ts` (scripts are entry points); esbuild.

**Must not depend on:** Being imported by `src/` or `tests/`.

**Planned contents:**
- `smoke-llm.ts` — asks for `{"ok": true}` through `generateStructured`; `npm run smoke:llm` (written in Phase 3; 1 LLM call)
- `smoke-parser.ts` — `npm run smoke:parser -- "<prompt>"` → `{ topic, maxDepth }` (written in Phase 4; 1 LLM call)
- `smoke-expand.ts` — `npm run smoke:expand -- "<topic>" [depth] [maxDepth]`: one real expand → verify → consolidate (written in Phase 5; 1-2 LLM calls)
- `smoke-node.ts` — `npm run smoke:node -- "<prompt>" [maxDepth=1]`: a real end-to-end build on the local queue, printing the tree and stats. Cost is about `branching ^ maxDepth` LLM calls, so the default is 1 (~6 calls); raise it only when the provider quota allows (written in Phase 6). Running out of quota is not an error case: it prints the partial tree with unbuilt nodes marked `[blocked]`, the run's `haltReason`, and exits 1 (Phase 6.1)
- `consistency-check.ts` — `npm run consistency -- "<topic>" [runs=3] [depth] [maxDepth]`: runs one node N times and reports child counts and overlap; compare `LLM_TEMPERATURE` / `LLM_SEED_MODE` settings (N LLM calls; C47)
- `build-lambdas.mjs` — esbuild bundles of the three handlers → `dist/lambda/<fn>.zip`; `npm run build:lambda` (Phase 13)

**Design notes:**
- Scripts that call a real LLM, Supabase or AWS need `service/.env` filled in by the user; they print pass/fail and never print secrets.

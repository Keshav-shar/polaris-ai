# scripts/

**Purpose:** Manual smoke scripts and build scripts. Run from `service/`. Smoke scripts are not part of the test suite and never run in CI.

**May depend on:** Anything under `src/`, including `composition/` and `config/env.ts` (scripts are entry points); esbuild.

**Must not depend on:** Being imported by `src/` or `tests/`.

**Planned contents:**
- `smoke-llm.ts` — asks for `{"ok": true}` through `generateStructured`; `npm run smoke:llm` (written in Phase 3; 1 LLM call)
- `smoke-parser.ts` — `npm run smoke:parser -- "<prompt>"` → `{ topic, maxDepth }` (written in Phase 4; 1 LLM call)
- `smoke-expand.ts` — `npm run smoke:expand -- "<topic>" [depth] [maxDepth]`: one real expand → verify → consolidate (written in Phase 5; 1-2 LLM calls)
- `smoke-node.ts` — `npm run smoke:node -- "<prompt>" [maxDepth=1]`: a real end-to-end build on the local queue - BOTH passes, so a healthy run ends `done` with its scrolls written (it used to start only the construction worker, so it could never get past `constructed`; C91). It settles when both workers are idle at the same instant, then prints the tree and stats. Cost is about `branching ^ maxDepth` expand calls plus one search and one writer call per node, so the default is 1 (~6 nodes); raise it only when the provider quota allows (written in Phase 6). Running out of quota is not an error case: it prints the partial tree with unbuilt nodes marked `[blocked]`, the run's `haltReason`, and exits 1 (Phase 6.1)
- `model-eval.ts` — `npm run model-eval [-- <model> ...]`: vets pool members on BOTH prompts before they go into the rotation (expand at an interior layer, expand at the leaf layer, one writer call over fixed evidence, so no search runs and a difference between two models is the model). Reports the leaf rule, words against the band, INVENTED citations and question count. 3 LLM calls per model, writes nothing (C92)
- `redact.ts` — `failureDetail(env, error)`: the ONE failure formatter every script here uses. Delegates to `shared/failure-reason.ts` and scrubs the provider key through `llmKeys(env)`, so no script can echo a key back (C58, C93)
- `smoke-evidence.ts` — `npm run smoke:evidence -- "<topic>" [parentTopic]`: retrieval + the credibility gate only, no LLM call. Wikipedia needs no key (Phase 9)
- `consistency-check.ts` — `npm run consistency -- "<topic>" [runs=3] [depth] [maxDepth]`: runs one node N times and reports child counts and overlap; compare `LLM_TEMPERATURE` / `LLM_SEED_MODE` settings (N LLM calls; C47)
- `docs-check.ts` — `npm run docs:check`: no network, no LLM. Fails when a doc or README quotes a constant with a value `config/constants.ts` no longer has, or repeats a retired claim (on-demand quizzes, the archived MVP spec, the deleted failover adapter, ...). Skips `docs/conflicts.md`, `docs/archive/` and `TASK_PROGRESS_CONTEXT.md`, which quote old values on purpose (Phase 10.6, C97)
- `build-lambdas.mjs` — esbuild bundles of the three handlers → `dist/lambda/<fn>.zip`; `npm run build:lambda` (Phase 13)

**Design notes:**
- Scripts that call a real LLM, Supabase or AWS need `service/.env` filled in by the user; they print pass/fail and never print secrets.

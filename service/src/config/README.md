# config/

**Purpose:** Constants and validated environment configuration.

**May depend on:** zod.

**Must not depend on:** Anything else. `constants.ts` is pure data and may be imported by any layer; `env.ts` exposes a lazy, memoized `getEnv()` (never validated at import time, so tests need no `.env`) and is called only from `composition/` and entry points (`interfaces/http/server.ts`, the Lambda handlers via `composition/worker-container.ts`).

**Planned contents:**
- `constants.ts` — all current-scope constants, written in Phase 2 (schema first): `ROOT_DEPTH` 0, `DEFAULT_MAX_DEPTH` 5, `MAX_DEPTH_CEILING` 6, `BRIEF_MAX_WORDS` 50, `ANCESTOR_WINDOW` 2, `TAPER_LAYERS` 2 (last two layers including the leaf), `EXPAND` (`MAX_CHILDREN` 15, never in the expand prompt; C46), `QUEUE` (`MAX_RECEIVES` 3, `SEND_BATCH_MAX` 10), `NODE_STATE_TTL_DAYS` 7, `LLM`, `TEMPERATURE_BY_LABEL` (C47), `WORKER` (`EXPAND_CONCURRENCY` 2), `PROMPT_VERSION`, `MAX_NODES_PER_RUN` 60 (the run's total node ceiling; C60), `MAX_CONCURRENT_RUNS` 1 (runs allowed to be `constructing` at once — bounds concurrent quota draw, where `MAX_NODES_PER_RUN` bounds one run's size; Phase 7, C61), `HTTP_RETRY_AFTER` (seconds put in a 429's `Retry-After`; the quota value is only a fallback when the provider states no wait), `CREDIBILITY`, `RETRIEVAL`, `ARTICLE` (`MAX_WORDS` 100), `QUIZ_CONFIG` (QUESTIONS_PER_TOPIC 5, PASSING_SCORE_PERCENT 70, MAX_GUARDRAIL_RETRIES 2; sitewide)
- `env.ts` — `getEnv()` (lazy, memoized): `API_PORT`, `CORS_ORIGIN`, `LOG_LEVEL`, `QUEUE_MODE` (`memory` | `sqs`), `WORKER_EXPAND_CONCURRENCY`, `MAX_NODES_PER_RUN`, `MAX_CONCURRENT_RUNS`, two LLM profiles selected by `LLM_PROVIDER` (`LLM_*` and `LLM_FALLBACK_*`, each with its own `_DAILY_REQUEST_BUDGET`; C49, C58), shared `LLM_JSON_MODE` / `LLM_MAX_CONCURRENCY` / `LLM_TEMPERATURE` / `LLM_SEED_MODE`, and optional search / Supabase / AWS keys. `requireLlmEnv(env, profile?)` and `isLlmConfigured(env, profile?)` take an optional profile so either can be inspected without changing `LLM_PROVIDER`; only the ACTIVE profile is validated. `requireSupabaseEnv` / `requireAwsEnv` are NOT written yet (Phase 12 / 13)

**Design notes:**
- Values are fixed by `docs/node-builder-mvp-spec.md`; `docs/traversal-algorithm.md` mirrors them in its parameter table. Change both together.
- Queue settings that live in AWS (visibility timeout, max receives, W) are documented in `docs/aws-retrofit.md`; `QUEUE.MAX_RECEIVES` mirrors the redrive policy so the local worker behaves the same.

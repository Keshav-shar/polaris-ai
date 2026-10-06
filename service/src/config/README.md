# config/

**Purpose:** Constants and validated environment configuration.

**May depend on:** zod.

**Must not depend on:** Anything else. `constants.ts` is pure data and may be imported by any layer; `env.ts` exposes a lazy, memoized `getEnv()` (never validated at import time, so tests need no `.env`) and is called only from `composition/` and entry points (`interfaces/http/server.ts`, the Lambda handlers via `composition/worker-container.ts`).

**Planned contents:**
- `constants.ts` — every current-scope constant, and the ONLY place their values are written (docs name them, never quote them; C97): `ROOT_DEPTH`, `DEFAULT_MAX_DEPTH`, `MAX_DEPTH_CEILING`, `BRIEF_MAX_WORDS`, `ANCESTOR_WINDOW`, `TAPER_LAYERS` (last two layers including the leaf), `EXPAND` (`MAX_CHILDREN`, never in the expand prompt; C46), `QUEUE` (`MAX_RECEIVES`, `SEND_BATCH_MAX`, `STALL_MAX_RELEASES`, `STALL_DELAY_MS`; C94), `NODE_STATE_TTL_DAYS`, `LLM`, `MODEL_POOL`, `TEMPERATURE_BY_LABEL` (C47), `WORKER` (`EXPAND_CONCURRENCY`, `ARTICLE_CONCURRENCY`), `PROMPT_VERSION`, `MAX_NODES_PER_RUN` (the run's total node ceiling; C60), `RUNS_LIST_LIMIT`, `MAX_CONCURRENT_RUNS` (runs allowed to be `constructing` at once — bounds concurrent quota draw, where `MAX_NODES_PER_RUN` bounds one run's size; Phase 7, C61), `HTTP_RETRY_AFTER` (seconds put in a 429's `Retry-After`; the quota value is only a fallback when the provider states no wait), `CREDIBILITY`, `RETRIEVAL`, `SEARCH`, `ARTICLE` (`MAX_WORDS` - a runaway GUARD, not a target; the target is the band in `domain/traversal/article-budget.ts`, C85), `QUIZ_CONFIG` (`QUESTIONS_PER_TOPIC`, `PASSING_SCORE_PERCENT`, `MAX_GUARDRAIL_RETRIES`; sitewide, C74)
- `env.ts` — `getEnv()` (lazy, memoized): `API_PORT`, `CORS_ORIGIN`, `LOG_LEVEL`, `QUEUE_MODE` (`memory` | `sqs`), `WORKER_EXPAND_CONCURRENCY`, `WORKER_ARTICLE_CONCURRENCY`, `MAX_NODES_PER_RUN`, `MAX_CONCURRENT_RUNS`, ONE LLM provider (`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_DAILY_REQUEST_BUDGET`) with its model pool (`LLM_MODELS`, `LLM_WRITER_MODELS`, `LLM_MODEL_ROTATION`) and `LLM_JSON_MODE` / `LLM_MAX_CONCURRENCY` / `LLM_TEMPERATURE` / `LLM_SEED_MODE`, and optional search / Supabase / AWS keys. `parseEnv` REFUSES a `.env` that still sets `LLM_PROVIDER` or any `LLM_FALLBACK_*`, naming the variable each one becomes - the live Groq key used to sit in `LLM_FALLBACK_API_KEY`, so ignoring them would silently start an unconfigured process (C93). `requireSupabaseEnv` / `requireAwsEnv` are NOT written yet (Phase 12 / 13)

**Design notes:**
- Values live here only. `docs/traversal-algorithm.md` names the construction constants and says what each does; `npm run docs:check` fails when a doc quotes a stale value.
- Queue settings that live in AWS (visibility timeout, max receives, W) are documented in `docs/aws-retrofit.md`; `QUEUE.MAX_RECEIVES` mirrors the redrive policy so the local worker behaves the same.

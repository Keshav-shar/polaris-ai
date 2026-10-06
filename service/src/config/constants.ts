// The ONLY place these values are written. Docs name the constants and explain them, never quote the
// numbers (docs/conflicts.md C97); `npm run docs:check` fails on a known stale copy.

// --- Construction ---
export const ROOT_DEPTH = 0; // root is depth 0; maxDepth = levels beneath the root
export const DEFAULT_MAX_DEPTH = 5;
export const MAX_DEPTH_CEILING = 6; // hard upper bound on user-requested depth (cost safety)
export const BRIEF_MAX_WORDS = 50; // a brief must be strictly fewer words than this
export const ANCESTOR_WINDOW = 2; // ancestor levels carried in the per-request context
export const TAPER_LAYERS = 2; // last two layers, INCLUDING the leaf: maxDepth - 1 tapers, maxDepth is the leaf
// Children kept per node. Never put into the expand prompt (a stated number invites padding); over the cap, the
// consolidator merges, drops and ranks down to it (docs/conflicts.md C46).
export const EXPAND = { MAX_CHILDREN: 15 } as const;

// Total nodes one run may create, the cost ceiling Q6 left open. Depth alone cannot bound cost:
// estimateExpandCalls says depth 2 = 31 calls but depth 5 = 3,906 and the ceiling depth 6 = 19,531, and
// an HTTP caller has no maxDepth override to hide behind the way scripts/smoke-node.ts does.
// 500 clears a full depth-3 tree. Raised from 60 once a Groq model pool lifted the daily ceiling from
// 1,000 to ~3,250 expand calls (docs/conflicts.md C68): at 60 a real depth-2 build reported
// nodesSkipped: 19, so the tree arrived truncated. Cost arithmetic for 500: 500 expand calls now, ~1,000
// once the Phase 10 article pass adds its own call per node, i.e. ~3 full runs a day against the pool.
// Override per environment with MAX_NODES_PER_RUN; the frontier is trimmed, never the requested maxDepth
// (docs/conflicts.md C60).
export const MAX_NODES_PER_RUN = 500;

// Most runs GET /api/runs will return. The Codex fetches one tree per run, so this also bounds how many
// tree reads one page load triggers. Runs are in-memory until Phase 12, so the list empties on restart.
export const RUNS_LIST_LIMIT = 20;

// Runs allowed to be `constructing` at once in one process. MAX_NODES_PER_RUN bounds how big ONE run gets;
// this bounds how many runs draw on the provider quota at the same time, which is the limit an HTTP caller
// can otherwise walk straight past by posting twice. Override with MAX_CONCURRENT_RUNS (docs/conflicts.md C61).
export const MAX_CONCURRENT_RUNS = 1;

// Seconds put in `Retry-After` when a request is refused with 429. The quota value is only a fallback: a
// provider-stated wait (QuotaExhaustedError.retryAfterMs) is used whenever there is one.
export const HTTP_RETRY_AFTER = {
  RUN_IN_PROGRESS_SECONDS: 15,
  QUOTA_FALLBACK_SECONDS: 3600,
  // A network fault clears on its own and usually within seconds, so it is worth asking for quickly -
  // unlike a daily quota, which is hours away (C94).
  TRANSPORT_SECONDS: 15,
} as const;

// --- Queue and in-flight state (mirror the SQS redrive policy and batch limit; see docs/aws-retrofit.md) ---
export const QUEUE = {
  MAX_RECEIVES: 3,
  SEND_BATCH_MAX: 10,
  // A stall (the provider is unreachable) is not the node's fault, so it is redelivered WITHOUT counting
  // a receive - but not forever: past this many, a node stops being given free attempts and falls back to
  // the counted path, so a permanently dead network ends the run instead of cycling in it. 5 x 15 s is
  // ~75 s of tolerance, against the ~1-minute blip that permanently killed 14 articles on 2026-09-24
  // (docs/conflicts.md C94). In Phase 13 the delay is the SQS visibility timeout and the receive IS
  // counted there, so maxReceiveCount: 3 still ends a long outage in the DLQ.
  STALL_MAX_RELEASES: 5,
  STALL_DELAY_MS: 15_000,
} as const;
export const NODE_STATE_TTL_DAYS = 7;

// Messages handled at once by one consumer: the local worker's W_expand, the SQS event-source Maximum
// Concurrency in Phase 13. Start at 2 and raise from the provider's RPM (docs/conflicts.md Q11).
// W_expand and W_article. Q11 answered: start at 2 + 2, then raise from the provider's real RPM. The
// article pass adds a search plus an LLM call per node, so its concurrency is bounded separately.
export const WORKER = { EXPAND_CONCURRENCY: 2, ARTICLE_CONCURRENCY: 2 } as const;

// --- LLM ---
// Temperature is sent only when LLM_TEMPERATURE is set: a model tuned for its own default is worse off
// with an imposed one, so the default is to send nothing (docs/conflicts.md C47).
// When it is set, these per-call overrides (keyed by generateStructured label) replace it for extraction-style calls.
export const TEMPERATURE_BY_LABEL: Readonly<Record<string, number>> = { parser: 0, consolidate: 0 };

export const LLM = {
  MAX_REPAIR_ATTEMPTS: 2,
  // The adapter owns the retry loop (the SDK runs with maxRetries: 0), so it can classify a 429 before
  // spending an attempt on it: a daily quota fails fast, a burst limit backs off. docs/conflicts.md C50.
  MAX_RETRIES: 6,
  RETRY_BASE_MS: 500,
  RETRY_MAX_MS: 8_000,
  // A 429 asking us to wait longer than this is a daily quota, not a burst limit: no retry will outlast it.
  DAILY_QUOTA_RETRY_AFTER_MS: 300_000,
  TIMEOUT_MS: 60_000,
} as const;

// Rotation across models of ONE provider (infrastructure/llm/model-pool.adapter.ts). Groq's limits are
// per (organization, model), so a pool multiplies capacity; these bound what that costs.
export const MODEL_POOL = {
  // TOTAL provider requests one chat() may spend across ALL members, matching a single adapter's budget
  // (1 + LLM.MAX_RETRIES). Rotation must multiply capacity, never cost.
  MAX_ATTEMPTS: 1 + LLM.MAX_RETRIES,
  // How long to shelve a member whose retryable error stated no wait (5xx, bare network error). Anything
  // the server DOES state is honoured in full; a stated wait longer than DAILY_QUOTA_RETRY_AFTER_MS was
  // already classified daily-quota, so cooldowns stay bounded by that.
  DEFAULT_COOLDOWN_MS: 5_000,
} as const;


// Namespaces every cached expansion. Bump on ANY change to the expand / consolidator / context-snippet
// prompts, so stale entries are missed rather than served (docs/conflicts.md C47).
export const PROMPT_VERSION = "1";

// --- Evidence (article pass) ---
export const CREDIBILITY = { MIN_SCORE: 0.6, MIN_CREDIBLE_SOURCES: 2 } as const;
export const RETRIEVAL = { MAX_RESULTS: 5 } as const;

// Search providers for the article pass. Wikipedia needs no key and no quota beyond identifying itself,
// which is why it is the default (docs/free-tier-constraints.md).
export const SEARCH = {
  WIKIPEDIA_API_URL: "https://en.wikipedia.org/w/api.php",
  WIKIPEDIA_PAGE_URL: "https://en.wikipedia.org/w/index.php",
  TAVILY_API_URL: "https://api.tavily.com/search",
  // A hung search must not hold a node's article for the whole Lambda timeout.
  TIMEOUT_MS: 15_000,
} as const;

// --- Articles ---
// MAX_WORDS is a RUNAWAY GUARD, not a target. The target is a band derived from the node's own shape
// (domain/traversal/article-budget.ts), because measurement showed a model left to decide length on its
// own is neither repeatable (84% spread on the same leaf) nor correct (it writes leaves SHORTER than
// their parents, inverting the design). Raised from 100 by docs/conflicts.md C85, which reverses C32/C73.
// The `ArticleOutput` refine keeps using this so generateStructured's repair loop still shortens a draft
// that genuinely runs away, rather than letting it reach storage and the per-minute token budget.
// Counted on contentMd only; citations are excluded.
export const ARTICLE = { MAX_WORDS: 1500 } as const;

// --- Quizzes: sitewide shape, never per-topic ---
export const QUIZ_CONFIG = {
  // 3, not 5, and generated inside the writer's own call rather than on demand (docs/conflicts.md C74).
  // Still sitewide and never per-topic; QuizOutput is `.length()` of this, so the schema follows.
  QUESTIONS_PER_TOPIC: 3,
  PASSING_SCORE_PERCENT: 70,
  MAX_GUARDRAIL_RETRIES: 2,
} as const;

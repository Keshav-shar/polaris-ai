// Values are fixed by docs/node-builder-mvp-spec.md and docs/POLARIS_BUILD_PLAN.md (Phase 2).
// docs/traversal-algorithm.md mirrors the construction values; change both together.

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
// 60 is chosen to clear a full depth-2 tree (31 nodes, the M1 exit criterion) with room for wider
// branching, while stopping depth 3 (156) less than half way. Override per environment with
// MAX_NODES_PER_RUN; the frontier is trimmed, never the requested maxDepth (docs/conflicts.md C60).
export const MAX_NODES_PER_RUN = 60;

// Runs allowed to be `constructing` at once in one process. MAX_NODES_PER_RUN bounds how big ONE run gets;
// this bounds how many runs draw on the provider quota at the same time, which is the limit an HTTP caller
// can otherwise walk straight past by posting twice. Override with MAX_CONCURRENT_RUNS (docs/conflicts.md C61).
export const MAX_CONCURRENT_RUNS = 1;

// Seconds put in `Retry-After` when a request is refused with 429. The quota value is only a fallback: a
// provider-stated wait (QuotaExhaustedError.retryAfterMs) is used whenever there is one.
export const HTTP_RETRY_AFTER = { RUN_IN_PROGRESS_SECONDS: 15, QUOTA_FALLBACK_SECONDS: 3600 } as const;

// --- Queue and in-flight state (mirror the SQS redrive policy and batch limit; see docs/aws-retrofit.md) ---
export const QUEUE = { MAX_RECEIVES: 3, SEND_BATCH_MAX: 10 } as const;
export const NODE_STATE_TTL_DAYS = 7;

// Messages handled at once by one consumer: the local worker's W_expand, the SQS event-source Maximum
// Concurrency in Phase 13. Start at 2 and raise from the provider's RPM (docs/conflicts.md Q11).
export const WORKER = { EXPAND_CONCURRENCY: 2 } as const;

// --- LLM ---
// Temperature is sent only when LLM_TEMPERATURE is set (Gemini 3 wants its default 1.0; docs/conflicts.md C47).
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

// Namespaces every cached expansion. Bump on ANY change to the expand / consolidator / context-snippet
// prompts, so stale entries are missed rather than served (docs/conflicts.md C47).
export const PROMPT_VERSION = "1";

// --- Evidence (article pass) ---
export const CREDIBILITY = { MIN_SCORE: 0.6, MIN_CREDIBLE_SOURCES: 2 } as const;
export const RETRIEVAL = { MAX_RESULTS: 5 } as const;

// --- Articles: at most MAX_WORDS words of contentMd, citations excluded ---
export const ARTICLE = { MAX_WORDS: 100 } as const;

// --- Quizzes: sitewide shape, never per-topic ---
export const QUIZ_CONFIG = {
  QUESTIONS_PER_TOPIC: 5,
  PASSING_SCORE_PERCENT: 70,
  MAX_GUARDRAIL_RETRIES: 2,
} as const;

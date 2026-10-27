// The ONLY place these values are written. Docs name the constants and explain them, never quote the
// numbers (docs/conflicts.md C97); `npm run docs:check` fails on a known stale copy.

// --- Construction ---
export const ROOT_DEPTH = 0; // root is depth 0; maxDepth = levels beneath the root
// Used when neither the request body nor the prompt ("… 2 levels deep") states a depth. 3 keeps a full tree
// under MAX_NODES_PER_RUN at the balanced branch cap (domain/traversal/branch-cap.ts, docs/conflicts.md C101).
export const DEFAULT_MAX_DEPTH = 3;
export const MAX_DEPTH_CEILING = 6; // hard upper bound on user-requested depth (cost safety)
export const BRIEF_MAX_WORDS = 50; // a brief must be strictly fewer words than this
// Longest topic a node may carry. Model output and the provisional run title are both cut to it, so an
// over-long reply cannot inflate every prompt below it (docs/conflicts.md C103).
export const TOPIC_MAX_CHARS = 120;
export const ANCESTOR_WINDOW = 2; // ancestor levels carried in the per-request context
export const TAPER_LAYERS = 2; // last two layers, INCLUDING the leaf: maxDepth - 1 tapers, maxDepth is the leaf
// Children kept per node. Never put into the expand prompt (a stated number invites padding); over the cap the
// list is cut in the model's teaching order. The balanced branch cap (domain/traversal/branch-cap.ts) usually
// binds first; this is the absolute ceiling. No consolidator call any more (docs/conflicts.md C101 supersedes C46).
export const EXPAND = { MAX_CHILDREN: 15 } as const;

// Total nodes one run may create, the cost ceiling Q6 left open. Depth alone cannot bound cost: a full tree at
// branching 5 is 31 nodes at depth 2 but 3,906 at depth 5 and 19,531 at the ceiling depth 6 (estimate-calls.ts).
// 500 clears a full depth-3 tree. Raised from 60 once a Groq model pool lifted the daily ceiling (C68): at 60 a
// real depth-2 build reported nodesSkipped: 19. Cost arithmetic for 500 since C99: ~1 writer call per node plus
// one expand call per INTERIOR node (~20%), i.e. ~600 calls, ~5 full runs a day against a ~3,000/day pool.
// Override per environment with MAX_NODES_PER_RUN. Since C101 it also sets the balanced branch cap - every
// node keeps at most b children, b the largest with 1 + b + ... + b^maxDepth <= this - so every branch reaches
// the same depth; RunStatePort.reserveNodes stays as the backstop (C60). The requested maxDepth is never lowered.
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
// The root expansion also names the topic (it absorbed the parser, docs/conflicts.md C100), so it keeps the
// extraction-style 0 the parser had.
export const TEMPERATURE_BY_LABEL: Readonly<Record<string, number>> = { "expand-root": 0 };

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

// How hard a reasoning model thinks before it answers. Ordered: an `@effort` on a pool member in .env is the
// MOST that member may be asked for, and a call gets the lesser of the two (docs/conflicts.md C113).
export const REASONING_EFFORTS = ["none", "low", "medium", "high"] as const;

// Per-call shaping, keyed by generateStructured label (C112, C113). Measured 2026-10-07 on one expand prompt
// with strict json_schema: gpt-oss-120b 729 -> 209 completion tokens (587 -> 21 of them reasoning) and
// 2.2 s -> 0.9 s at `low` against its default `medium`; gpt-oss-20b 886 -> 150 tokens, 1.5 s -> 0.5 s.
// Tokens/minute is the binding Groq limit (8,000 per model), so an expansion at `low` costs roughly a
// quarter of the budget it used to. The writer keeps `medium` (= the gpt-oss default, so unchanged): an
// article is the product, and its reasoning is what keeps citations honest.
//
// maxCompletionTokens is supported per label but deliberately UNSET (C112, revised by measurement the same
// day). A cap ENTERS Groq's admission estimate: a writer request was refused with `413 ... TPM Limit 8000,
// Requested 8568` = a ~1,195-token prompt + ~0.9 x an 8,192 cap, and a 115-token probe with that cap was
// charged `Requested 7477` against tokens/day - while with no cap the same requests are estimated at about
// prompt + 1,700. A cap big enough for an article (~3,400 completion tokens measured, half of it reasoning)
// therefore makes every writer call look larger than the per-minute limit itself. Reasoning effort (above)
// is the token lever instead. If a cap is ever set here, a reply cut by it logs `llm reply truncated` at warn.
export const LLM_CALL_PROFILE: Readonly<
  Record<string, { reasoningEffort: (typeof REASONING_EFFORTS)[number]; maxCompletionTokens?: number }>
> = {
  "expand-root": { reasoningEffort: "low" },
  expand: { reasoningEffort: "low" },
  writer: { reasoningEffort: "medium" },
};

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
  // Requests/minute a member is paced to before a 429 has told us its real limit. Groq states that limit
  // only in a 429 body ("... requests per minute (RPM): Limit 30 ..."), never in a header, so the pacer starts
  // here and adopts whatever a 429 body states (C130).
  DEFAULT_RPM: 30,
  // Rough prompt-size estimate for the token-headroom check: characters per token. Deliberately coarse - the
  // provider's own 429 stays authoritative; this only stops a request that would plainly not fit.
  CHARS_PER_TOKEN: 4,
  // What Groq adds for the reply when it decides whether a request fits the minute: with no completion cap a
  // request is estimated at about prompt + 1,700 tokens (measured 2026-10-07, C112). Leaving it out let the
  // pacer admit writer calls Groq then refused ("Used 7700, Requested 4113", seen live 2026-10-14, C130).
  ADMISSION_OUTPUT_TOKENS: 1_700,
} as const;

// Who goes first when LLM work queues for a slot (C129, C130): a scroll a learner is waiting on, then
// construction (every article below depends on it), then articles shallowest-first. Lower rank goes first;
// depth breaks ties within a lane, then arrival order.
export const LLM_PRIORITY_LANES = { "boosted-article": 0, expand: 1, article: 2 } as const;


// Namespaces every cached expansion. Bump on ANY change to the expand / context-snippet prompts or the
// expansion's shape, so stale entries are missed rather than served (docs/conflicts.md C47).
// "2": children carry their own briefs and the root names the topic (C99, C100).
export const PROMPT_VERSION = "2";

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
  // Search text is untrusted and goes straight into the writer prompt: cap it so one provider reply cannot
  // flood the prompt or the per-minute token budget (docs/conflicts.md C103).
  TITLE_MAX_CHARS: 200,
  // Since C122 the "snippet" is the page's intro extract, cut here. 1,000 chars was the user's choice
  // (2026-10-07): ~250 tokens per source, so up to ~+1,000 writer prompt tokens per article (5 sources) against
  // ~40 each for a search snippet - roughly -20% articles/day under the 200K tokens/day ceiling (C119), paid
  // for text a claim can actually be checked against (C124).
  SNIPPET_MAX_CHARS: 1_000,
  // A bounded process-level cache in front of the search port (C126): a redelivered article reuses its
  // search instead of calling Wikipedia again. Bounded by count AND age so it cannot grow with the process.
  CACHE_MAX_ENTRIES: 500,
  CACHE_TTL_MS: 60 * 60 * 1000,
} as const;

// Lexical groundedness of a citation against the source it cites (C124): at least MIN_OVERLAP of the claim's
// content words must be in that source, and every number. A claim with fewer than MIN_CLAIM_WORDS content
// words is too short to judge and is kept unjudged. Starting values; calibrated on real writer output in
// Phase 10.9 (see docs/conflicts.md for the measured numbers behind any change).
export const GROUNDEDNESS = { MIN_OVERLAP: 0.5, MIN_CLAIM_WORDS: 3 } as const;

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

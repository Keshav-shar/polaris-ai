import { z } from "zod";
import { MAX_CONCURRENT_RUNS, MAX_NODES_PER_RUN, WORKER } from "./constants";

export class EnvError extends Error {
  override readonly name = "EnvError";
}

// `KEY=` in a .env file means "not set", not "set to empty".
const optionalString = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());
const optionalUrl = z.preprocess((v) => (v === "" ? undefined : v), z.url().optional());
const optionalCount = z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(1).optional());

function withDefault<T extends z.ZodType>(schema: T, fallback: z.input<T>) {
  return z.preprocess((v) => (v === "" || v === undefined ? fallback : v), schema);
}

const EnvSchema = z
  .object({
    API_PORT: withDefault(z.coerce.number().int().min(1).max(65535), "4000"),
    CORS_ORIGIN: withDefault(z.url(), "http://localhost:3000"),
    LOG_LEVEL: withDefault(z.enum(["debug", "info", "warn", "error"]), "info"),
    QUEUE_MODE: withDefault(z.enum(["memory", "sqs"]), "memory"),

    // ONE provider (docs/conflicts.md C93, reversing C49/C58/C59): the OpenAI-compatible endpoint of a
    // Groq account. The only switching left is between that account's MODELS, which the pool below does.
    LLM_BASE_URL: optionalUrl,
    LLM_API_KEY: optionalString,
    LLM_MODEL: optionalString,
    // Extra rotation members, AFTER the LLM_MODEL lead. Comma-separated, order = rotation order. Each
    // entry may carry that model's own requests/day as `id=rpd`, which lets the pool retire a member
    // BEFORE it 429s: `openai/gpt-oss-20b=1000,qwen/qwen3.8-27b=1000`. `=` is the separator because it
    // appears in no provider model id, where `:` does (OpenRouter's `:free`). Members share the base URL
    // and key, so only ONE account is involved. Leaving this empty keeps single-model behaviour exactly.
    // The vetted list is `docs/models.md`; `npm run model-eval` is what puts a model on it.
    LLM_MODELS: optionalString,
    // The pool the WRITER draws on, when it should differ from the one construction uses. Same format,
    // same account; the lead is this list's first entry, not LLM_MODEL. Unset = the writer shares
    // construction's pool, which is the behaviour before C92. It exists because the two calls are not the
    // same size: an expansion is a brief plus a handful of topics, an article is 350-1100 words plus 3
    // questions, so a model whose per-minute OUTPUT cap is under the band can expand all day and never
    // write a single scroll (`OTPM Limit 1000, Requested 2048`).
    LLM_WRITER_MODELS: optionalString,
    // off        - single model, even if LLM_MODELS is set (escape hatch).
    // exhaustion - rotate only when a member is out for the DAY. Per-minute limits still back off inside
    //              the member adapter, so C50 holds and a tree usually stays on one model. MEASURED to
    //              be near-useless on Groq: the binding limit there is 30 requests/MINUTE per model, which
    //              this policy ignores by design (139 s for a depth-2 build, against 153 s unpooled).
    // throttle   - rotate on a per-minute 429 too. It lifts the per-minute wall REACTIVELY: the same
    //              build takes 20.8 s. The cost is that models interleave within one tree (C68).
    // round-robin - throttle, but each call STARTS at the next member instead of always at the lead, so
    //              the load is spread BEFORE any limit is hit. The default since C92: under throttle the
    //              lead absorbs every request until it 429s, so one model's tokens/minute is the ceiling
    //              while the rest of the pool idles - which is what made the article pass, whose calls
    //              are ~10x larger than an expansion's, the place runs lost their scrolls.
    LLM_MODEL_ROTATION: withDefault(z.enum(["off", "exhaustion", "throttle", "round-robin"]), "round-robin"),
    LLM_JSON_MODE: withDefault(z.enum(["true", "false"]), "true").transform((v) => v === "true"),
    LLM_MAX_CONCURRENCY: withDefault(z.coerce.number().int().min(1), "4"),
    // Unset = the provider's default. Set 0-0.2 for models that tune well.
    LLM_TEMPERATURE: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().min(0).max(2).optional()),
    // node = send a seed derived from the node id (only if the provider accepts `seed`).
    LLM_SEED_MODE: withDefault(z.enum(["off", "node"]), "off"),
    // The LEAD model's documented requests-per-day, when it has one. Unset = no known ceiling. Used ONLY
    // to warn before an over-budget build; it never lowers maxDepth. Each pool member carries its own in
    // LLM_MODELS, and the run's budget is their sum.
    LLM_DAILY_REQUEST_BUDGET: optionalCount,

    // W_expand: messages one consumer handles at once. Mirrors the SQS event-source Maximum Concurrency.
    WORKER_EXPAND_CONCURRENCY: withDefault(z.coerce.number().int().min(1), String(WORKER.EXPAND_CONCURRENCY)),
    // W_article. The article pass spends a search AND an LLM call per node, so it is bounded
    // separately from construction (Q11: start at 2 + 2, raise from the provider's real RPM).
    WORKER_ARTICLE_CONCURRENCY: withDefault(z.coerce.number().int().min(1), String(WORKER.ARTICLE_CONCURRENCY)),
    // The run's total node ceiling (Q6). Raise it only as far as the provider quota genuinely allows -
    // every node is an LLM call, and a second one again in the article pass.
    MAX_NODES_PER_RUN: withDefault(z.coerce.number().int().min(1), String(MAX_NODES_PER_RUN)),
    // Concurrent `constructing` runs allowed. 1 keeps a single-user local build from racing itself through
    // the provider's per-minute limit; raise it only with a provider whose RPM genuinely allows it (C61).
    MAX_CONCURRENT_RUNS: withDefault(z.coerce.number().int().min(1), String(MAX_CONCURRENT_RUNS)),

    SEARCH_PROVIDER: withDefault(z.enum(["wikipedia", "tavily"]), "wikipedia"),
    TAVILY_API_KEY: optionalString,
    SEARCH_USER_AGENT: optionalString,

    SUPABASE_URL: optionalUrl,
    SUPABASE_SERVICE_ROLE_KEY: optionalString,

    AWS_REGION: optionalString,
    AWS_ACCESS_KEY_ID: optionalString,
    AWS_SECRET_ACCESS_KEY: optionalString,
    NODE_EXPAND_QUEUE_URL: optionalUrl,
    ARTICLE_WRITE_QUEUE_URL: optionalUrl,
    NODES_TABLE_NAME: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.SEARCH_PROVIDER === "tavily" && !env.TAVILY_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["TAVILY_API_KEY"],
        message: "is required when SEARCH_PROVIDER=tavily",
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export type RotationPolicy = "off" | "exhaustion" | "throttle" | "round-robin";

// One rotation member: the model id plus its OWN requests/day when the provider publishes one.
export type PoolModel = { id: string; dailyRequestBudget: number | undefined };

export type LlmEnv = {
  baseUrl: string;
  apiKey: string;
  // The LEAD model, always `models[0].id`. Kept as its own field so every existing reader (smoke scripts,
  // the selected-model log line, env tests) still sees the configured lead.
  model: string;
  // The ordered rotation pool, ALWAYS non-empty: [lead, ...LLM_MODELS].
  models: readonly [PoolModel, ...PoolModel[]];
  // The WRITER's own pool (LLM_WRITER_MODELS), or undefined when it shares `models`. Not merged with
  // the lead: its whole purpose is to leave out models that can expand but cannot write (C92).
  writerModels: readonly [PoolModel, ...PoolModel[]] | undefined;
  rotation: RotationPolicy;
  // The run's requests/day: the SUM over every member, or undefined when ANY member's ceiling is
  // unknown - half a budget is a worse warning than none.
  dailyRequestBudget: number | undefined;
  jsonMode: boolean;
  maxConcurrency: number;
  temperature: number | undefined;
  seedMode: "off" | "node";
};

// Deleted with the second provider profile (C93). A stale one in `.env` must FAIL rather than be
// ignored: the live Groq key used to sit in `LLM_FALLBACK_API_KEY`, so silently dropping these would
// start the process against the empty `LLM_*` names and report "LLM is not configured" - or, worse,
// against a leftover Gemini key that is no longer wanted.
const REMOVED_LLM_VARS: Readonly<Record<string, string>> = {
  LLM_PROVIDER: "remove it: there is only one provider now",
  LLM_FALLBACK_BASE_URL: "move its value to LLM_BASE_URL",
  LLM_FALLBACK_API_KEY: "move its value to LLM_API_KEY",
  LLM_FALLBACK_MODEL: "move its value to LLM_MODEL",
  LLM_FALLBACK_MODELS: "move its value to LLM_MODELS",
  LLM_FALLBACK_WRITER_MODELS: "move its value to LLM_WRITER_MODELS",
  LLM_FALLBACK_DAILY_REQUEST_BUDGET: "move its value to LLM_DAILY_REQUEST_BUDGET",
};

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Checked on the RAW source, before zod strips what it does not know about, and only for a non-empty
  // value: a leftover `LLM_FALLBACK_MODELS=` line carries nothing to migrate.
  const stale = Object.entries(REMOVED_LLM_VARS).filter(([name]) => {
    const value = source[name];
    return value !== undefined && value !== "";
  });
  if (stale.length > 0) {
    throw new EnvError(
      "service/.env still sets variables removed with the second provider profile:\n" +
        stale.map(([name, fix]) => `  ${name}: ${fix}`).join("\n") +
        "\nGroq is now the only provider; see docs/models.md for the exact block.",
    );
  }
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    // prettifyError reports paths and messages; with reportInput off (the default) no values are echoed.
    throw new EnvError(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

let cached: Env | undefined;

// Lazy and memoized: never validated at import time, so tests and scripts need no .env.
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

// Parses `id`, `id=rpd`, comma-separated. Split on the LAST `=` so a model id containing one survives.
// A malformed budget is an error rather than a silent undefined: it would otherwise disable the
// proactive-retirement it was written to enable, and nothing would say so.
function parsePoolModels(raw: string | undefined, varName: string): PoolModel[] {
  if (raw === undefined) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const at = entry.lastIndexOf("=");
      if (at === -1) return { id: entry, dailyRequestBudget: undefined };
      const id = entry.slice(0, at).trim();
      const budget = Number(entry.slice(at + 1).trim());
      if (id === "" || !Number.isInteger(budget) || budget < 1) {
        throw new EnvError(
          `${varName}: "${entry}" is malformed. Use "model-id" or "model-id=requestsPerDay" ` +
            "(a positive integer), comma-separated. See docs/setup.md.",
        );
      }
      return { id, dailyRequestBudget: budget };
    });
}

export function isLlmConfigured(env: Env): boolean {
  return Boolean(env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL);
}

export function requireLlmEnv(env: Env): LlmEnv {
  const baseUrl = env.LLM_BASE_URL;
  const apiKey = env.LLM_API_KEY;
  const model = env.LLM_MODEL;
  if (!baseUrl || !apiKey || !model) {
    // Names what the user must set, which is the whole point of failing here rather than at the call.
    const missing = (
      [
        ["LLM_BASE_URL", baseUrl],
        ["LLM_API_KEY", apiKey],
        ["LLM_MODEL", model],
      ] as const
    ).flatMap(([name, value]) => (value ? [] : [name]));
    throw new EnvError(
      `LLM is not configured. Set ${missing.join(", ")} in service/.env (see docs/setup.md).`,
    );
  }
  // The lead always heads the pool. Deduped against the lead and each other, first occurrence winning:
  // a repeat is harmless rather than wrong, and config here has no logger to warn through.
  const lead: PoolModel = { id: model, dailyRequestBudget: env.LLM_DAILY_REQUEST_BUDGET };
  const seen = new Set([model]);
  const extras = parsePoolModels(env.LLM_MODELS, "LLM_MODELS").filter(
    (m) => !seen.has(m.id) && seen.add(m.id),
  );
  const models: [PoolModel, ...PoolModel[]] = [lead, ...extras];
  // undefined if ANY member's ceiling is unknown: warning against a partial budget is worse than none.
  const poolBudget = models.some((m) => m.dailyRequestBudget === undefined)
    ? undefined
    : models.reduce((sum, m) => sum + (m.dailyRequestBudget ?? 0), 0);
  // Its own list, NOT the lead plus extras: the point is to exclude models construction is happy with.
  // Deduped the same way, and undefined when unset so composition can reuse the one pool it already has.
  const writerSeen = new Set<string>();
  const writerPool = parsePoolModels(env.LLM_WRITER_MODELS, "LLM_WRITER_MODELS").filter(
    (m) => !writerSeen.has(m.id) && writerSeen.add(m.id),
  );
  return {
    baseUrl,
    apiKey,
    model,
    models,
    writerModels: writerPool.length === 0 ? undefined : (writerPool as [PoolModel, ...PoolModel[]]),
    rotation: env.LLM_MODEL_ROTATION,
    dailyRequestBudget: poolBudget,
    jsonMode: env.LLM_JSON_MODE,
    maxConcurrency: env.LLM_MAX_CONCURRENCY,
    temperature: env.LLM_TEMPERATURE,
    seedMode: env.LLM_SEED_MODE,
  };
}

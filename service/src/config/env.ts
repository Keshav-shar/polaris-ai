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

    // Two provider profiles, one active per process (docs/conflicts.md C49). Gemini's free tier is
    // 5 RPM / 20 RPD, so a longer run needs Groq or an OpenRouter `:free` model instead.
    LLM_PROVIDER: withDefault(z.enum(["primary", "fallback"]), "primary"),
    LLM_BASE_URL: optionalUrl,
    LLM_API_KEY: optionalString,
    LLM_MODEL: optionalString,
    LLM_FALLBACK_BASE_URL: optionalUrl,
    LLM_FALLBACK_API_KEY: optionalString,
    LLM_FALLBACK_MODEL: optionalString,
    LLM_JSON_MODE: withDefault(z.enum(["true", "false"]), "true").transform((v) => v === "true"),
    LLM_MAX_CONCURRENCY: withDefault(z.coerce.number().int().min(1), "4"),
    // Unset = the provider's default (required for Gemini 3). Set 0-0.2 for models that tune well.
    LLM_TEMPERATURE: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().min(0).max(2).optional()),
    // node = send a seed derived from the node id (only if the provider accepts `seed`).
    LLM_SEED_MODE: withDefault(z.enum(["off", "node"]), "off"),
    // Each profile's documented requests-per-day, when it has one (Gemini free tier: 20). Unset = no
    // known ceiling. Used ONLY to warn before an over-budget build; it never lowers maxDepth. Per-profile
    // because the two providers' ceilings differ by orders of magnitude (docs/conflicts.md C58).
    LLM_DAILY_REQUEST_BUDGET: optionalCount,
    LLM_FALLBACK_DAILY_REQUEST_BUDGET: optionalCount,

    // W_expand: messages one consumer handles at once. Mirrors the SQS event-source Maximum Concurrency.
    WORKER_EXPAND_CONCURRENCY: withDefault(z.coerce.number().int().min(1), String(WORKER.EXPAND_CONCURRENCY)),
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
    // Only the ACTIVE profile must be complete: a Gemini-only setup never has to fill the fallback in.
    if (env.LLM_PROVIDER === "fallback") {
      for (const name of ["LLM_FALLBACK_BASE_URL", "LLM_FALLBACK_API_KEY", "LLM_FALLBACK_MODEL"] as const) {
        if (!env[name]) {
          ctx.addIssue({ code: "custom", path: [name], message: "is required when LLM_PROVIDER=fallback" });
        }
      }
    }
    if (env.SEARCH_PROVIDER === "tavily" && !env.TAVILY_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["TAVILY_API_KEY"],
        message: "is required when SEARCH_PROVIDER=tavily",
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export type LlmProvider = "primary" | "fallback";

// baseUrl/apiKey/model/dailyRequestBudget belong to ONE profile; the rest is shared across profiles.
export type LlmEnv = {
  provider: LlmProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  // That profile's requests/day, or undefined when the provider publishes no daily ceiling.
  dailyRequestBudget: number | undefined;
  jsonMode: boolean;
  maxConcurrency: number;
  temperature: number | undefined;
  seedMode: "off" | "node";
};

export function parseEnv(source: Record<string, string | undefined>): Env {
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

type ProfileVars = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  budget?: number;
  names: [string, string, string];
};

// One profile's own variables, by their real names, so errors name what the user must set. Takes the
// profile rather than reading LLM_PROVIDER, because failover has to build BOTH (docs/conflicts.md C59).
function llmVarsFor(env: Env, profile: LlmProvider): ProfileVars {
  return profile === "fallback"
    ? {
        baseUrl: env.LLM_FALLBACK_BASE_URL,
        apiKey: env.LLM_FALLBACK_API_KEY,
        model: env.LLM_FALLBACK_MODEL,
        budget: env.LLM_FALLBACK_DAILY_REQUEST_BUDGET,
        names: ["LLM_FALLBACK_BASE_URL", "LLM_FALLBACK_API_KEY", "LLM_FALLBACK_MODEL"],
      }
    : {
        baseUrl: env.LLM_BASE_URL,
        apiKey: env.LLM_API_KEY,
        model: env.LLM_MODEL,
        budget: env.LLM_DAILY_REQUEST_BUDGET,
        names: ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"],
      };
}

export function isLlmConfigured(env: Env, profile: LlmProvider = env.LLM_PROVIDER): boolean {
  const { baseUrl, apiKey, model } = llmVarsFor(env, profile);
  return Boolean(baseUrl && apiKey && model);
}

export function requireLlmEnv(env: Env, profile: LlmProvider = env.LLM_PROVIDER): LlmEnv {
  const { baseUrl, apiKey, model, budget, names } = llmVarsFor(env, profile);
  if (!baseUrl || !apiKey || !model) {
    const missing = [baseUrl, apiKey, model].flatMap((value, i) => (value ? [] : [names[i]!]));
    throw new EnvError(
      `LLM is not configured (LLM_PROVIDER=${profile}). ` +
        `Set ${missing.join(", ")} in service/.env (see docs/setup.md).`,
    );
  }
  return {
    provider: profile,
    baseUrl,
    apiKey,
    model,
    dailyRequestBudget: budget,
    jsonMode: env.LLM_JSON_MODE,
    maxConcurrency: env.LLM_MAX_CONCURRENCY,
    temperature: env.LLM_TEMPERATURE,
    seedMode: env.LLM_SEED_MODE,
  };
}

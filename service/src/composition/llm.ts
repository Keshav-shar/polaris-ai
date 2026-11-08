import type { LlmCallEvent } from "../application/ports/llm.port";
import type { RateWindowPort } from "../application/ports/rate-window.port";
import { MODEL_POOL } from "../config/constants";
import { type Env, type LlmEnv, type PoolModel, requireLlmEnv } from "../config/env";
import { createPriorityLimiter, type PriorityLimiter } from "../infrastructure/llm/concurrency";
import { createModelPacer, type ModelPacer } from "../infrastructure/llm/model-pacer";
import { createModelPoolLlm, type PoolMember } from "../infrastructure/llm/model-pool.adapter";
import { createOpenAiCompatibleLlm } from "../infrastructure/llm/openai-compatible.adapter";
import type { SwitchableLlm } from "../infrastructure/llm/switchable";
import { createMemoryRateWindowStore } from "../infrastructure/memory/memory-rate-window.store";
import type { Logger } from "../shared/logger";

// What the rest of the process needs to know about the LLM: the port itself, the model currently
// answering (reporting only), the expansion-cache namespace (stable under rotation), and the requests/day
// the run can actually draw on - the sum over the pool's members.
export type LlmStack = {
  llm: SwitchableLlm;
  // What the WRITER calls. The same instance as `llm` unless LLM_WRITER_MODELS names its own pool: an
  // article is ~10x an expansion's output, so the two calls do not necessarily suit the same models (C92).
  writerLlm: SwitchableLlm;
  activeModel(): string;
  cacheNamespace(): string;
  dailyRequestBudget: number | undefined;
};

// What every pool in the process shares (C129, C130): ONE priority limiter, so LLM_MAX_CONCURRENCY caps the
// whole process and a boosted article outranks an expansion across pools, and ONE pacer per model id, because
// Groq limits each (organization, model) and the expand and writer pools may both name the same model.
type SharedLimits = {
  limiter: PriorityLimiter;
  pacerFor(model: string): ModelPacer;
};

function createSharedLimits(config: LlmEnv, window: RateWindowPort, now: () => number): SharedLimits {
  const pacers = new Map<string, ModelPacer>();
  return {
    limiter: createPriorityLimiter(config.maxConcurrency),
    pacerFor(model) {
      let pacer = pacers.get(model);
      if (pacer === undefined) {
        pacer = createModelPacer({ model, window, requestsPerMinute: MODEL_POOL.DEFAULT_RPM, now });
        pacers.set(model, pacer);
      }
      return pacer;
    },
  };
}

// A pool rotating over the account's models, which share its base URL and key. `throttle` and `round-robin`
// give members maxRetries: 0 so the POOL, not the member, decides what a per-minute 429 means; `exhaustion`
// leaves the member's own backoff in place, so C50 holds unchanged and only a daily quota moves the pool on.
// Since C93 there is no second provider to switch to: the pool IS the resilience, which is why a member's own
// requests/day matters (it retires before it 429s).
//
// One model (rotation `off`, or a list of one) is a ONE-member pool under `exhaustion` - the old single
// adapter's behaviour, its own retries included - so it gets the shared limiter and its pacer too, and keeps
// the bare model id as its cache namespace (C131).
//
// With LLM_API_KEY_NEXT every model is offered once per key, model-major ([m1@key1, m1@key2, m2@key1, ...]),
// so the lead model stays first and round-robin alternates accounts. Each (key, model) gets its own pacer,
// because each is its own Groq bucket. Rotation `off` is still ONE model on ONE key. The cache namespace
// depends on the models only: the key does not change what a model writes.
function createPoolLlm(
  config: LlmEnv,
  shared: SharedLimits,
  logger: Pick<Logger, "debug" | "info" | "warn">,
  onCall: ((event: LlmCallEvent) => void) | undefined,
  // Which pool to build. Defaults to the construction pool; the writer passes its own.
  pool: readonly [PoolModel, ...PoolModel[]] = config.models,
): SwitchableLlm {
  const off = config.rotation === "off";
  const keys = off ? [config.apiKeys[0]] : config.apiKeys;
  const models = off ? [pool[0]] : pool;
  const single = models.length * keys.length === 1;
  const rotating = !single && config.rotation !== "exhaustion";
  const members = models.flatMap((m) =>
    keys.map((apiKey, k): PoolMember => {
      // Key 1 keeps the bare model id as its pacing key, so a one-key setup paces exactly as before. The label
      // names the key's POSITION, never any of its characters.
      const account = `key${k + 1}`;
      const pacer = shared.pacerFor(k === 0 ? m.id : `${m.id}#${account}`);
      return {
        llm: createOpenAiCompatibleLlm({
          ...config,
          apiKey,
          model: m.id,
          // Its own reasoning ceiling, the shared logger + usage observer (C113, C116), and its pacer.
          maxReasoningEffort: m.maxReasoningEffort,
          logger,
          ...(onCall === undefined ? {} : { onCall }),
          pacer,
          // Both rotating policies hand the 429 decision to the POOL, so the member must not sleep through it.
          ...(rotating ? { maxRetries: 0 } : {}),
        }),
        model: m.id,
        ...(keys.length > 1 ? { account } : {}),
        dailyRequestBudget: m.dailyRequestBudget,
        pacer,
      };
    }),
  ) as [PoolMember, ...PoolMember[]];

  return createModelPoolLlm({
    members,
    policy: single || config.rotation === "off" ? "exhaustion" : config.rotation,
    maxConcurrency: config.maxConcurrency,
    limiter: shared.limiter,
    // One MODEL keeps its bare id as the namespace however many keys serve it (C131).
    ...(models.length === 1 ? { namespace: models[0].id } : {}),
    logger,
  });
}

// Throws EnvError naming the missing variables. Call once per process: each adapter holds its own
// limiter. What is live is logged, because it decides both the cost and the cache namespace.
// `onCall` sees every completed provider request (label, model, latency, tokens) - what the smoke run and
// the quality metrics total (C116).
// `window` is the requests/minute store: in memory for this process now, DynamoDB from Phase 13 (A13).
export function createLlmFromEnv(
  env: Env,
  logger?: Logger,
  onCall?: (event: LlmCallEvent) => void,
  { window = createMemoryRateWindowStore(), now = Date.now }: { window?: RateWindowPort; now?: () => number } = {},
): LlmStack {
  const config = requireLlmEnv(env);
  const log = logger ?? { debug: () => {}, info: () => {}, warn: () => {} };
  const shared = createSharedLimits(config, window, now);

  const llm = createPoolLlm(config, shared, log, onCall);
  // The same instance when no writer pool is configured, so a single-pool setup keeps one namespace and one
  // set of adapters. With a writer pool the limiter and the pacers are still the SAME objects (C129).
  const writerLlm =
    config.writerModels === undefined ? llm : createPoolLlm(config, shared, log, onCall, config.writerModels);

  logger?.info("llm selected", {
    model: config.model,
    rotation: config.rotation,
    // How many accounts, never which: a count is all an operator needs to see the second key is live.
    keys: config.rotation === "off" ? 1 : config.apiKeys.length,
    models: config.models.map((m) => (m.maxReasoningEffort === undefined ? m.id : `${m.id}@${m.maxReasoningEffort}`)),
    writerModels:
      config.writerModels?.map((m) => (m.maxReasoningEffort === undefined ? m.id : `${m.id}@${m.maxReasoningEffort}`)) ??
      null,
    // The namespace decides whether the cache is warm, so it belongs in the one line that already logs
    // the cost-relevant facts.
    cacheNamespace: llm.cacheNamespace(),
  });

  return {
    llm,
    writerLlm,
    activeModel: () => llm.activeModel(),
    cacheNamespace: () => llm.cacheNamespace(),
    dailyRequestBudget: config.dailyRequestBudget,
  };
}

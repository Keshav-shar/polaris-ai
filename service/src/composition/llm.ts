import { type Env, isLlmConfigured, type LlmEnv, type PoolModel, requireLlmEnv } from "../config/env";
import { createModelPoolLlm, type PoolMember } from "../infrastructure/llm/model-pool.adapter";
import { createOpenAiCompatibleLlm } from "../infrastructure/llm/openai-compatible.adapter";
import { fixedModelLlm, type SwitchableLlm } from "../infrastructure/llm/switchable";
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

// A single adapter, or a pool rotating over the account's models, which share its base URL and key.
// `throttle` and `round-robin` give members maxRetries: 0 so the POOL, not the member, decides what a
// per-minute 429 means; `exhaustion` leaves the member's own backoff in place, so C50 holds unchanged and
// only a daily quota moves the pool on. Since C93 there is no second provider to switch to: the pool IS
// the resilience, which is why a member's own requests/day matters (it retires before it 429s).
function createPoolLlm(
  config: LlmEnv,
  logger: Pick<Logger, "info" | "warn">,
  // Which pool to build. Defaults to the construction pool; the writer passes its own.
  pool: readonly [PoolModel, ...PoolModel[]] = config.models,
): SwitchableLlm {
  if (config.rotation === "off" || pool.length === 1) {
    return fixedModelLlm(createOpenAiCompatibleLlm({ ...config, model: pool[0].id }), pool[0].id);
  }
  // Both rotating policies hand the 429 decision to the POOL, so the member must not sleep through it.
  const throttling = config.rotation === "throttle" || config.rotation === "round-robin";
  const members = pool.map(
    (m): PoolMember => ({
      llm: createOpenAiCompatibleLlm({ ...config, model: m.id, ...(throttling ? { maxRetries: 0 } : {}) }),
      model: m.id,
      dailyRequestBudget: m.dailyRequestBudget,
    }),
  ) as [PoolMember, ...PoolMember[]];

  return createModelPoolLlm({
    members,
    policy: config.rotation,
    // ONE limiter for the whole pool: N members must not silently multiply LLM_MAX_CONCURRENCY, which is
    // documented as the cap across the whole process.
    maxConcurrency: config.maxConcurrency,
    logger,
  });
}

// The provider key, for the callers that must scrub a string before it is shown: a smoke script, or a
// stored articleFailureReason bound for the API. Composition owns this because it is the only layer
// allowed to read env. A list, not a single value, because the scrubbers take a list and an
// unconfigured environment must yield an empty one rather than `undefined` (docs/conflicts.md C58, C93).
export function llmKeys(env: Env): string[] {
  return isLlmConfigured(env) ? [requireLlmEnv(env).apiKey] : [];
}

// Throws EnvError naming the missing variables. Call once per process: each adapter holds its own
// limiter. What is live is logged, because it decides both the cost and the cache namespace.
export function createLlmFromEnv(env: Env, logger?: Logger): LlmStack {
  const config = requireLlmEnv(env);
  const log = logger ?? { info: () => {}, warn: () => {} };

  const llm = createPoolLlm(config, log);
  // The same instance when no writer pool is configured, so a single-pool setup keeps one limiter, one
  // namespace and one set of adapters.
  const writerLlm =
    config.writerModels === undefined ? llm : createPoolLlm(config, log, config.writerModels);

  logger?.info("llm selected", {
    model: config.model,
    rotation: config.rotation,
    models: config.models.map((m) => m.id),
    writerModels: config.writerModels?.map((m) => m.id) ?? null,
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

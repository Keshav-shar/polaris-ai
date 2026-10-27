import OpenAI from "openai";
import type {
  ChatMessage,
  ChatOptions,
  LlmCallEvent,
  LlmPort,
  ReasoningEffort,
  ResponseSchema,
} from "../../application/ports/llm.port";
import { LLM, REASONING_EFFORTS } from "../../config/constants";
import { QuotaExhaustedError } from "../../domain/errors/quota-exhausted.error";
import { TransportUnavailableError } from "../../domain/errors/transport-unavailable.error";
import type { Logger } from "../../shared/logger";
import { createLimiter } from "./concurrency";
import type { ModelPacer } from "./model-pacer";
import {
  classifyLlmError,
  type OptionalFeature,
  parseRateHeaders,
  rateHeadersOfError,
  unsupportedFeature,
} from "./rate-limit";

export type OpenAiCompatibleConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  jsonMode: boolean;
  maxConcurrency: number;
  // undefined = never send temperature, so the provider's own default applies.
  temperature?: number | undefined;
  seedMode?: "off" | "node";
  // Retries this adapter makes ITSELF, default LLM.MAX_RETRIES. Set 0 when a caller above owns the retry
  // decision - the model pool under LLM_MODEL_ROTATION=throttle, which must SEE a per-minute 429 at
  // attempt 0 to rotate instead of sleeping through it. A daily quota still throws QuotaExhaustedError,
  // because that branch precedes the attempt-budget check.
  maxRetries?: number;
  // The most reasoning THIS model may be asked for (`@effort` on its .env entry). A call asking for more is
  // clamped to it; undefined = no ceiling. Exists because defaults differ by model: gpt-oss reasons at
  // `medium` unless told otherwise, qwen not at all - so "low" saves tokens on one and spends them on the
  // other (measured 2026-10-07, C113).
  maxReasoningEffort?: ReasoningEffort | undefined;
  logger?: Pick<Logger, "debug" | "warn">;
  // Every completed request, for usage totals (C116). Never throws into the call.
  onCall?: (event: LlmCallEvent) => void;
  // This model's pacer, told what the provider said about its limits: the token headers on every response
  // and a 429, and the requests/minute limit a 429 body states (C130). Admission is the POOL's job.
  pacer?: Pick<ModelPacer, "observeHeaders" | "observeRequestsPerMinute">;
};

type ResponseFormat =
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: { name: string; strict: true; schema: Record<string, unknown> } };

type CompletionRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  seed?: number;
  response_format?: ResponseFormat;
  reasoning_effort?: ReasoningEffort;
  max_completion_tokens?: number;
};

type Completion = {
  choices: { finish_reason?: string | null; message: { content: string | null } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number } | null;
  } | null;
};

// The slice of the SDK this adapter uses; lets tests inject a fake without network or `any`. The SDK's
// promise also offers `withResponse()`, which is how the rate-limit headers are read; a fake without it
// simply reports no headers.
export type ChatCompletionsClient = {
  chat: {
    completions: {
      create(body: CompletionRequest): PromiseLike<Completion> & {
        withResponse?: () => PromiseLike<{ data: Completion; response: { headers: unknown } }>;
      };
    };
  };
};

export type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The lesser of what the call wants and what the model may be asked for.
export function clampEffort(
  requested: ReasoningEffort | undefined,
  ceiling: ReasoningEffort | undefined,
): ReasoningEffort | undefined {
  if (requested === undefined || ceiling === undefined) return requested;
  return REASONING_EFFORTS.indexOf(requested) <= REASONING_EFFORTS.indexOf(ceiling) ? requested : ceiling;
}

// The client for the provider's OpenAI-compatible endpoint (Groq; the shape is the same for any of
// them). The SDK runs with
// maxRetries: 0 so the retry loop lives here, where a 429 can be classified BEFORE an attempt is spent on
// it: a daily quota throws at once, a burst limit backs off (docs/conflicts.md C50). The limiter keeps
// in-flight calls inside the provider's free-tier RPM.
//
// Optional parameters (strict response schema, reasoning effort, completion cap) are sent by default and
// DROPPED for this model the first time it rejects one by name: a model that does not take a parameter
// costs one extra request per process, never a failed call (C113, C114).
export function createOpenAiCompatibleLlm(
  config: OpenAiCompatibleConfig,
  client?: ChatCompletionsClient,
  sleep: Sleep = defaultSleep,
): LlmPort {
  const sdk: ChatCompletionsClient =
    client ??
    new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
      maxRetries: 0,
      timeout: LLM.TIMEOUT_MS,
    });
  const limit = createLimiter(config.maxConcurrency);
  const maxRetries = config.maxRetries ?? LLM.MAX_RETRIES;
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError(`maxRetries must be a non-negative integer, got ${String(config.maxRetries)}`);
  }
  // Per model, for the life of the process: what this model has refused by name.
  const rejected = new Set<OptionalFeature>();

  const responseFormat = (options: ChatOptions): ResponseFormat | undefined => {
    if (!options.json || !config.jsonMode) return undefined;
    const schema: ResponseSchema | undefined = options.responseSchema;
    if (schema === undefined || rejected.has("responseSchema")) return { type: "json_object" };
    return { type: "json_schema", json_schema: { name: schema.name, strict: true, schema: schema.schema } };
  };

  // Built per attempt, because a rejection mid-call changes what the next attempt may send.
  const request = (messages: readonly ChatMessage[], options: ChatOptions) => {
    const format = responseFormat(options);
    const effort = rejected.has("reasoningEffort")
      ? undefined
      : clampEffort(options.reasoningEffort, config.maxReasoningEffort);
    const cap = rejected.has("maxCompletionTokens") ? undefined : options.maxCompletionTokens;
    const body: CompletionRequest = {
      model: config.model,
      messages: [...messages],
      // A per-call temperature only refines a configured one; with none configured the provider default applies.
      ...(config.temperature !== undefined ? { temperature: options.temperature ?? config.temperature } : {}),
      ...(config.seedMode === "node" && options.seed !== undefined ? { seed: options.seed } : {}),
      ...(format === undefined ? {} : { response_format: format }),
      ...(effort === undefined ? {} : { reasoning_effort: effort }),
      ...(cap === undefined ? {} : { max_completion_tokens: cap }),
    };
    const sent = new Set<OptionalFeature>([
      ...(format?.type === "json_schema" ? (["responseSchema"] as const) : []),
      ...(effort === undefined ? [] : (["reasoningEffort"] as const)),
      ...(cap === undefined ? [] : (["maxCompletionTokens"] as const)),
    ]);
    return { body, sent, format, effort };
  };

  return {
    chat: (messages: readonly ChatMessage[], options: ChatOptions = {}) =>
      limit(async () => {
        for (let attempt = 0; ; attempt++) {
          const { body, sent, format, effort } = request(messages, options);
          const started = Date.now();
          let completion: Completion;
          try {
            const pending = sdk.chat.completions.create(body);
            if (pending.withResponse === undefined) {
              completion = await pending;
            } else {
              const { data, response } = await pending.withResponse();
              completion = data;
              const rate = parseRateHeaders(response.headers);
              if (rate !== undefined) config.pacer?.observeHeaders(rate);
            }
          } catch (error) {
            const rate = rateHeadersOfError(error);
            if (rate !== undefined) config.pacer?.observeHeaders(rate);
            const feature = unsupportedFeature(error);
            if (feature !== undefined && sent.has(feature)) {
              // Bounded: each feature can be dropped once, so this re-tries at most three times per model.
              rejected.add(feature);
              config.logger?.warn("llm feature unsupported by model, disabled for this process", {
                model: config.model,
                feature,
              });
              attempt -= 1;
              continue;
            }
            const classified = classifyLlmError(error);
            if (classified.requestsPerMinuteLimit !== undefined) {
              config.pacer?.observeRequestsPerMinute(classified.requestsPerMinuteLimit);
            }
            if (classified.kind === "daily-quota") {
              throw new QuotaExhaustedError(config.model, classified.retryAfterMs, classified.dailyLimit);
            }
            // The request never left the machine, so there is no status and nothing the provider did.
            // Retried like any other transient, but once the budget is gone it is raised as a STALL, not
            // as this node's failure: the consumer must not count a dead network against the node
            // (docs/conflicts.md C94).
            if (classified.kind === "network" && attempt >= maxRetries) {
              throw new TransportUnavailableError(`the LLM provider (${config.model})`, classified.detail);
            }
            if (classified.kind === "fatal" || attempt >= maxRetries) throw error;
            // A server-supplied retry-after is honoured in full: capping it would retry before the window
            // it names has passed, spending a request to be told the same thing. RETRY_MAX_MS bounds only
            // our own guess. Anything longer than DAILY_QUOTA_RETRY_AFTER_MS was classified daily above.
            await sleep(classified.retryAfterMs ?? Math.min(LLM.RETRY_MAX_MS, LLM.RETRY_BASE_MS * 2 ** attempt));
            continue;
          }

          const choice = completion.choices[0];
          const event: LlmCallEvent = {
            label: options.label ?? "unlabelled",
            model: config.model,
            ms: Date.now() - started,
            promptTokens: completion.usage?.prompt_tokens,
            completionTokens: completion.usage?.completion_tokens,
            reasoningTokens: completion.usage?.completion_tokens_details?.reasoning_tokens,
            finishReason: choice?.finish_reason ?? undefined,
            responseFormat: format?.type ?? "text",
            reasoningEffort: effort,
          };
          config.logger?.debug("llm call", event);
          try {
            config.onCall?.(event);
          } catch {
            // Usage accounting is an observer; it must never fail the call it is observing.
          }
          if (event.finishReason === "length") {
            // A cap bit. Loud, because a cap set too low would otherwise look like a model
            // that keeps returning broken JSON (the repair loop would quietly pay for it).
            config.logger?.warn("llm reply truncated at max_completion_tokens", {
              model: config.model,
              label: event.label,
              maxCompletionTokens: body.max_completion_tokens,
              completionTokens: event.completionTokens,
            });
          }
          // An empty completion is a contract violation, not a transport blip to retry.
          const content = choice?.message.content;
          if (!content) throw new Error("LLM returned no content");
          return content;
        }
      }),
  };
}

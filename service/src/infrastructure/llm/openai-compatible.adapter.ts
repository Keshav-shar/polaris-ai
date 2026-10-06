import OpenAI from "openai";
import type { ChatMessage, ChatOptions, LlmPort } from "../../application/ports/llm.port";
import { LLM } from "../../config/constants";
import { QuotaExhaustedError } from "../../domain/errors/quota-exhausted.error";
import { TransportUnavailableError } from "../../domain/errors/transport-unavailable.error";
import { createLimiter } from "./concurrency";
import { classifyLlmError } from "./rate-limit";

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
};

type CompletionRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  seed?: number;
  response_format?: { type: "json_object" };
};

// The slice of the SDK this adapter uses; lets tests inject a fake without network or `any`.
export type ChatCompletionsClient = {
  chat: {
    completions: {
      create(body: CompletionRequest): PromiseLike<{ choices: { message: { content: string | null } }[] }>;
    };
  };
};

export type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The client for the provider's OpenAI-compatible endpoint (Groq; the shape is the same for any of
// them). The SDK runs with
// maxRetries: 0 so the retry loop lives here, where a 429 can be classified BEFORE an attempt is spent on
// it: a daily quota throws at once, a burst limit backs off (docs/conflicts.md C50). The limiter keeps
// in-flight calls inside the provider's free-tier RPM.
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

  return {
    chat: (messages: readonly ChatMessage[], options: ChatOptions = {}) =>
      limit(async () => {
        for (let attempt = 0; ; attempt++) {
          let completion;
          try {
            completion = await sdk.chat.completions.create({
              model: config.model,
              messages: [...messages],
              // A per-call temperature only refines a configured one; with none configured the provider default applies.
              ...(config.temperature !== undefined
                ? { temperature: options.temperature ?? config.temperature }
                : {}),
              ...(config.seedMode === "node" && options.seed !== undefined ? { seed: options.seed } : {}),
              ...(options.json && config.jsonMode ? { response_format: { type: "json_object" } } : {}),
            });
          } catch (error) {
            const classified = classifyLlmError(error);
            if (classified.kind === "daily-quota") {
              throw new QuotaExhaustedError(config.model, classified.retryAfterMs);
            }
            // The request never left the machine, so there is no status and nothing the provider did.
            // Retried like any other transient, but once the budget is gone it is raised as a STALL, not
            // as this node's failure: the consumer must not count a dead network against the node
            // (docs/conflicts.md C94).
            if (classified.kind === "network" && attempt >= maxRetries) {
              throw new TransportUnavailableError(config.model, classified.detail);
            }
            if (classified.kind === "fatal" || attempt >= maxRetries) throw error;
            // A server-supplied retry-after is honoured in full: capping it would retry before the window
            // it names has passed, spending a request to be told the same thing. RETRY_MAX_MS bounds only
            // our own guess. Anything longer than DAILY_QUOTA_RETRY_AFTER_MS was classified daily above.
            await sleep(classified.retryAfterMs ?? Math.min(LLM.RETRY_MAX_MS, LLM.RETRY_BASE_MS * 2 ** attempt));
            continue;
          }
          // Outside the catch: an empty completion is a contract violation, not a transport blip to retry.
          const content = completion.choices[0]?.message.content;
          if (!content) throw new Error("LLM returned no content");
          return content;
        }
      }),
  };
}

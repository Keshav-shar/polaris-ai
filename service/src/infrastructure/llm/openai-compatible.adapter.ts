import OpenAI from "openai";
import type { ChatMessage, ChatOptions, LlmPort } from "../../application/ports/llm.port";
import { LLM } from "../../config/constants";
import { QuotaExhaustedError } from "../../domain/errors/quota-exhausted.error";
import { createLimiter } from "./concurrency";
import { classifyLlmError } from "./rate-limit";

export type OpenAiCompatibleConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  jsonMode: boolean;
  maxConcurrency: number;
  // undefined = never send temperature (provider default; required for Gemini 3).
  temperature?: number | undefined;
  seedMode?: "off" | "node";
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

// One client for every OpenAI-compatible provider (Gemini, Groq, OpenRouter). The SDK runs with
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
            if (classified.kind === "fatal" || attempt >= LLM.MAX_RETRIES) throw error;
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

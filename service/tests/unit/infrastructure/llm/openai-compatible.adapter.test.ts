import { APIError } from "openai";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../../../src/application/ports/llm.port";
import { LLM } from "../../../../src/config/constants";
import { QuotaExhaustedError } from "../../../../src/domain/errors/quota-exhausted.error";
import { fakeClock } from "../../../fixtures/fake-clock";
import {
  type ChatCompletionsClient,
  clampEffort,
  createOpenAiCompatibleLlm,
  type OpenAiCompatibleConfig,
} from "../../../../src/infrastructure/llm/openai-compatible.adapter";
import type { LlmCallEvent } from "../../../../src/application/ports/llm.port";

type Body = Parameters<ChatCompletionsClient["chat"]["completions"]["create"]>[0];

const config: OpenAiCompatibleConfig = {
  baseUrl: "https://api.example.test/v1",
  apiKey: "test-key",
  model: "test-model",
  jsonMode: true,
  maxConcurrency: 4,
};

function fakeClient(content: string | null = "{}", onCreate?: () => Promise<void>) {
  const bodies: Body[] = [];
  const client: ChatCompletionsClient = {
    chat: {
      completions: {
        create: async (body) => {
          bodies.push(body);
          await onCreate?.();
          return { choices: [{ message: { content } }] };
        },
      },
    },
  };
  return { client, bodies };
}

const messages: ChatMessage[] = [{ role: "user", content: "hi" }];

describe("createOpenAiCompatibleLlm", () => {
  it("passes the model and returns the reply text", async () => {
    const { client, bodies } = fakeClient("hello");
    await expect(createOpenAiCompatibleLlm(config, client).chat(messages)).resolves.toBe("hello");
    expect(bodies[0]).toMatchObject({ model: "test-model", messages });
  });

  it("never sends temperature when none is configured, even if the call asks for one", async () => {
    const { client, bodies } = fakeClient();
    await createOpenAiCompatibleLlm(config, client).chat(messages, { temperature: 0 });
    expect(bodies[0]).not.toHaveProperty("temperature");
  });

  it("sends the configured temperature, and a per-call value overrides it", async () => {
    const { client, bodies } = fakeClient();
    const llm = createOpenAiCompatibleLlm({ ...config, temperature: 0.3 }, client);
    await llm.chat(messages);
    await llm.chat(messages, { temperature: 0 });
    expect(bodies[0]!.temperature).toBe(0.3);
    expect(bodies[1]!.temperature).toBe(0);
  });

  it("sends a seed only in node seed mode", async () => {
    const off = fakeClient();
    await createOpenAiCompatibleLlm(config, off.client).chat(messages, { seed: 42 });
    expect(off.bodies[0]).not.toHaveProperty("seed");

    const on = fakeClient();
    const llm = createOpenAiCompatibleLlm({ ...config, seedMode: "node" }, on.client);
    await llm.chat(messages, { seed: 42 });
    await llm.chat(messages);
    expect(on.bodies[0]!.seed).toBe(42);
    expect(on.bodies[1]).not.toHaveProperty("seed");
  });

  it("sends response_format only when json is requested and JSON mode is enabled", async () => {
    const on = fakeClient();
    await createOpenAiCompatibleLlm(config, on.client).chat(messages, { json: true });
    expect(on.bodies[0]!.response_format).toEqual({ type: "json_object" });

    const notRequested = fakeClient();
    await createOpenAiCompatibleLlm(config, notRequested.client).chat(messages);
    expect(notRequested.bodies[0]).not.toHaveProperty("response_format");

    const disabled = fakeClient();
    await createOpenAiCompatibleLlm({ ...config, jsonMode: false }, disabled.client).chat(messages, { json: true });
    expect(disabled.bodies[0]).not.toHaveProperty("response_format");
  });

  it("throws when the provider returns no content", async () => {
    const { client } = fakeClient(null);
    await expect(createOpenAiCompatibleLlm(config, client).chat(messages)).rejects.toThrow("no content");
  });

  it("caps in-flight calls at maxConcurrency", async () => {
    let active = 0;
    let peak = 0;
    const { client } = fakeClient("{}", async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    });
    const llm = createOpenAiCompatibleLlm({ ...config, maxConcurrency: 2 }, client);
    await Promise.all(Array.from({ length: 6 }, () => llm.chat(messages)));
    expect(peak).toBe(2);
  });

  describe("retry and quota handling", () => {
    // The SDK runs with maxRetries: 0, so every attempt below is one the adapter chose to make.
    function failingClient(error: unknown, succeedAfter = Infinity) {
      let calls = 0;
      const client: ChatCompletionsClient = {
        chat: {
          completions: {
            create: async () => {
              calls += 1;
              if (calls > succeedAfter) return { choices: [{ message: { content: "{}" } }] };
              throw error;
            },
          },
        },
      };
      return {
        client,
        get calls() {
          return calls;
        },
      };
    }

    const ask = (llm: ReturnType<typeof createOpenAiCompatibleLlm>) =>
      llm.chat([{ role: "user", content: "hi" }] satisfies ChatMessage[]);

    it("throws QuotaExhaustedError on a daily quota after exactly one attempt", async () => {
      const daily = { status: 429, message: "Limit requests per day" };
      const failing = failingClient(daily);
      const clock = fakeClock();
      const llm = createOpenAiCompatibleLlm(config, failing.client, clock.sleep);

      await expect(ask(llm)).rejects.toThrow(QuotaExhaustedError);
      // The whole point: no backoff can outlast a daily quota, so none is spent on it.
      expect(failing.calls).toBe(1);
      expect(clock.sleeps).toEqual([]);
    });

    it("fast-fails on a daily quota thrown by the real SDK, not just a hand-built one", async () => {
      // The shape production throws. With `headers` a Headers instance the classifier used to lose the
      // status entirely, so this exact case spent 1 + MAX_RETRIES requests per node proving a quota was
      // gone - the failure that started all this (docs/conflicts.md C56).
      const body = [
        {
          error: {
            message: "Quota exceeded. limit: 20, model: gemini-3.6-flash. Please retry in 37.1s.",
            details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }],
          },
        },
      ];
      const sdkDaily = APIError.generate(429, body, "429 " + JSON.stringify(body), new Headers());
      const failing = failingClient(sdkDaily);
      const clock = fakeClock();
      const llm = createOpenAiCompatibleLlm(config, failing.client, clock.sleep);

      await expect(ask(llm)).rejects.toThrow(QuotaExhaustedError);
      expect(failing.calls).toBe(1);
      expect(clock.sleeps).toEqual([]);
    });

    it("waits the time a real per-minute 429 states in its body, not its own guess", async () => {
      // Gemini puts the delay in google.rpc.RetryInfo and sends no retry-after header, so the adapter
      // used to retry inside the window it had just been told to wait out.
      const body = [
        {
          error: {
            message: "Quota exceeded. limit: 5, model: gemini-3.6-flash. Please retry in 41.7s.",
            details: [{ violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] }],
          },
        },
      ];
      const perMinute = APIError.generate(429, body, "429 " + JSON.stringify(body), new Headers());
      const failing = failingClient(perMinute, 1);
      const clock = fakeClock();
      const llm = createOpenAiCompatibleLlm(config, failing.client, clock.sleep);

      await expect(ask(llm)).resolves.toBe("{}");
      expect(clock.sleeps).toEqual([41_700]);
    });

    it("names the model on the quota error, so the fix is obvious", async () => {
      const failing = failingClient({ status: 429, message: "free-models-per-day" });
      const llm = createOpenAiCompatibleLlm(config, failing.client, fakeClock().sleep);
      await expect(ask(llm)).rejects.toThrow(/test-model/);
      await expect(ask(llm)).rejects.toThrow(/LLM_MODELS/);
    });

    it("backs off exponentially on a burst limit and then succeeds", async () => {
      const failing = failingClient({ status: 429, message: "5 requests per minute" }, 2);
      const clock = fakeClock();
      const llm = createOpenAiCompatibleLlm(config, failing.client, clock.sleep);

      await expect(ask(llm)).resolves.toBe("{}");
      expect(failing.calls).toBe(3);
      expect(clock.sleeps).toEqual([LLM.RETRY_BASE_MS, LLM.RETRY_BASE_MS * 2]);
    });

    it("honours a server-supplied retry-after in full, even beyond RETRY_MAX_MS", async () => {
      const failing = failingClient(
        { status: 429, message: "slow down", headers: { "retry-after": "3" } },
        1,
      );
      const clock = fakeClock();
      await ask(createOpenAiCompatibleLlm(config, failing.client, clock.sleep));
      expect(clock.sleeps).toEqual([3000]);

      // Gemini asks for ~42s on a per-minute limit. Capping that at RETRY_MAX_MS would retry early and
      // spend a request to be told the same thing.
      const long = failingClient(
        { status: 429, message: "quotaId: GenerateRequestsPerMinutePerProjectPerModel-FreeTier", headers: { "retry-after": "42" } },
        1,
      );
      const clock2 = fakeClock();
      await ask(createOpenAiCompatibleLlm(config, long.client, clock2.sleep));
      expect(clock2.sleeps).toEqual([42_000]);
    });

    it("bounds its OWN guess at RETRY_MAX_MS when the server says nothing", async () => {
      const failing = failingClient({ status: 503, message: "overloaded" });
      const clock = fakeClock();
      await expect(ask(createOpenAiCompatibleLlm(config, failing.client, clock.sleep))).rejects.toBeTruthy();
      expect(Math.max(...clock.sleeps)).toBeLessThanOrEqual(LLM.RETRY_MAX_MS);
    });

    it("gives up after LLM.MAX_RETRIES and rethrows the provider's error", async () => {
      const failing = failingClient({ status: 503, message: "overloaded" });
      const llm = createOpenAiCompatibleLlm(config, failing.client, fakeClock().sleep);
      await expect(ask(llm)).rejects.toMatchObject({ status: 503 });
      expect(failing.calls).toBe(LLM.MAX_RETRIES + 1);
    });

    it("does not retry a bad key", async () => {
      const failing = failingClient({ status: 401, message: "invalid api key" });
      const llm = createOpenAiCompatibleLlm(config, failing.client, fakeClock().sleep);
      await expect(ask(llm)).rejects.toMatchObject({ status: 401 });
      expect(failing.calls).toBe(1);
    });

    it("does not retry an empty completion, which is a contract violation not a blip", async () => {
      const { client } = fakeClient(null);
      const llm = createOpenAiCompatibleLlm(config, client, fakeClock().sleep);
      await expect(ask(llm)).rejects.toThrow(/no content/);
    });

    // The contract the model pool depends on: with maxRetries 0 a retryable error must come back RAW and
    // immediately, so the pool can classify it and rotate to another model instead of sleeping here.
    describe("maxRetries override", () => {
      it("rethrows a retryable error raw after ONE attempt and never sleeps", async () => {
        const failing = failingClient({ status: 429, message: "tokens per minute (TPM): Limit 8000" });
        const clock = fakeClock();
        const llm = createOpenAiCompatibleLlm({ ...config, maxRetries: 0 }, failing.client, clock.sleep);
        await expect(ask(llm)).rejects.toMatchObject({ status: 429 });
        expect(failing.calls).toBe(1);
        expect(clock.sleeps).toEqual([]);
      });

      it("still throws QuotaExhaustedError on a daily quota, which precedes the attempt budget", async () => {
        const failing = failingClient({ status: 429, message: "Limit requests per day." });
        const llm = createOpenAiCompatibleLlm({ ...config, maxRetries: 0 }, failing.client, fakeClock().sleep);
        await expect(ask(llm)).rejects.toBeInstanceOf(QuotaExhaustedError);
        expect(failing.calls).toBe(1);
      });

      it("makes exactly maxRetries + 1 attempts", async () => {
        const failing = failingClient({ status: 503, message: "overloaded" });
        const llm = createOpenAiCompatibleLlm({ ...config, maxRetries: 2 }, failing.client, fakeClock().sleep);
        await expect(ask(llm)).rejects.toMatchObject({ status: 503 });
        expect(failing.calls).toBe(3);
      });

      it("rejects a negative or non-integer budget at construction", () => {
        const { client } = fakeClient();
        expect(() => createOpenAiCompatibleLlm({ ...config, maxRetries: -1 }, client)).toThrow(RangeError);
        expect(() => createOpenAiCompatibleLlm({ ...config, maxRetries: 1.5 }, client)).toThrow(RangeError);
      });
    });
  });

  // Phase 10.7: strict structured output, reasoning effort, the runaway cap and the per-call event.
  describe("request shaping (C112-C116)", () => {
    const schema = { name: "expand", schema: { type: "object", properties: {}, required: [], additionalProperties: false } };

    function scripted(steps: (() => unknown)[]) {
      const bodies: Body[] = [];
      const client: ChatCompletionsClient = {
        chat: {
          completions: {
            create: async (body) => {
              bodies.push(JSON.parse(JSON.stringify(body)) as Body);
              const step = steps.shift();
              const result = step?.();
              if (result instanceof Error) throw result;
              return (result ?? { choices: [{ finish_reason: "stop", message: { content: "{}" } }] }) as never;
            },
          },
        },
      };
      return { client, bodies };
    }

    const badRequest = (message: string, code?: string) =>
      new APIError(400, { message, ...(code === undefined ? {} : { code }) }, message, new Headers());

    function recorder() {
      const warnings: string[] = [];
      const debug: unknown[] = [];
      return {
        logger: { debug: (_m: string, c?: unknown) => void debug.push(c), warn: (m: string) => void warnings.push(m) },
        warnings,
        debug,
      };
    }

    it("sends a strict json_schema when the call carries one, and plain JSON mode when it does not", async () => {
      const { client, bodies } = scripted([]);
      const llm = createOpenAiCompatibleLlm(config, client);
      await llm.chat(messages, { json: true, responseSchema: schema });
      await llm.chat(messages, { json: true });
      expect(bodies[0]!.response_format).toEqual({
        type: "json_schema",
        json_schema: { name: "expand", strict: true, schema: schema.schema },
      });
      expect(bodies[1]!.response_format).toEqual({ type: "json_object" });
    });

    it("sends the label's effort and cap, clamped to the model's own ceiling", async () => {
      const { client, bodies } = scripted([]);
      await createOpenAiCompatibleLlm(config, client).chat(messages, { reasoningEffort: "medium", maxCompletionTokens: 4096 });
      await createOpenAiCompatibleLlm({ ...config, maxReasoningEffort: "none" }, client).chat(messages, {
        reasoningEffort: "low",
      });
      expect(bodies[0]).toMatchObject({ reasoning_effort: "medium", max_completion_tokens: 4096 });
      expect(bodies[1]!.reasoning_effort).toBe("none");
    });

    it("clampEffort picks the lesser, and leaves an unset side alone", () => {
      expect(clampEffort("high", "low")).toBe("low");
      expect(clampEffort("low", "medium")).toBe("low");
      expect(clampEffort("low", undefined)).toBe("low");
      expect(clampEffort(undefined, "none")).toBeUndefined();
    });

    // Recorded from Groq on 2026-10-07: "400 `reasoning_effort` must be one of `low`, `medium`, or `high`".
    it("drops a parameter the model rejects by name, retries at once, and never sends it to that model again", async () => {
      const { client, bodies } = scripted([
        () => badRequest("`reasoning_effort` must be one of `low`, `medium`, or `high`"),
      ]);
      const { logger, warnings } = recorder();
      const llm = createOpenAiCompatibleLlm({ ...config, maxRetries: 0, logger }, client);
      await expect(llm.chat(messages, { reasoningEffort: "none" })).resolves.toBe("{}");
      await llm.chat(messages, { reasoningEffort: "low" });
      expect(bodies.map((b) => b.reasoning_effort)).toEqual(["none", undefined, undefined]);
      expect(warnings).toEqual(["llm feature unsupported by model, disabled for this process"]);
    });

    it("falls back from json_schema to json_object when the schema is refused", async () => {
      const { client, bodies } = scripted([
        () => badRequest("invalid JSON schema for response_format: 'expand': unsupported string format 'uri'"),
      ]);
      const llm = createOpenAiCompatibleLlm({ ...config, maxRetries: 0 }, client);
      await llm.chat(messages, { json: true, responseSchema: schema });
      expect(bodies.map((b) => b.response_format?.type)).toEqual(["json_schema", "json_object"]);
    });

    it("does not mistake the model's own bad JSON (json_validate_failed) for an unsupported feature", async () => {
      const { client, bodies } = scripted([
        () => badRequest("Failed to validate JSON for response_format", "json_validate_failed"),
      ]);
      const llm = createOpenAiCompatibleLlm({ ...config, maxRetries: 1 }, client, async () => {});
      await llm.chat(messages, { json: true, responseSchema: schema });
      // Retried as a re-roll (C70) with the schema still on.
      expect(bodies.map((b) => b.response_format?.type)).toEqual(["json_schema", "json_schema"]);
    });

    it("rethrows a 400 about a parameter it never sent, instead of looping", async () => {
      const { client, bodies } = scripted([() => badRequest("`reasoning_effort` must be one of ...")]);
      const llm = createOpenAiCompatibleLlm({ ...config, maxRetries: 0 }, client);
      await expect(llm.chat(messages)).rejects.toThrow(/reasoning_effort/);
      expect(bodies).toHaveLength(1);
    });

    it("reports every completed request with its tokens, and warns when the cap cut a reply short", async () => {
      const { client } = scripted([
        () => ({
          choices: [{ finish_reason: "length", message: { content: "{" } }],
          usage: { prompt_tokens: 100, completion_tokens: 4096, completion_tokens_details: { reasoning_tokens: 3000 } },
        }),
      ]);
      const events: LlmCallEvent[] = [];
      const { logger, warnings, debug } = recorder();
      const llm = createOpenAiCompatibleLlm({ ...config, logger, onCall: (e) => void events.push(e) }, client);
      await llm.chat(messages, { json: true, label: "expand", reasoningEffort: "low", maxCompletionTokens: 4096 });
      expect(events).toEqual([
        expect.objectContaining({
          label: "expand",
          model: "test-model",
          promptTokens: 100,
          completionTokens: 4096,
          reasoningTokens: 3000,
          finishReason: "length",
          responseFormat: "json_object",
          reasoningEffort: "low",
        }),
      ]);
      expect(debug).toHaveLength(1);
      expect(warnings).toEqual(["llm reply truncated at max_completion_tokens"]);
    });

    it("never lets a throwing usage observer fail the call", async () => {
      const { client } = scripted([]);
      const llm = createOpenAiCompatibleLlm(
        {
          ...config,
          onCall: () => {
            throw new Error("observer broke");
          },
        },
        client,
      );
      await expect(llm.chat(messages)).resolves.toBe("{}");
    });
  });
});

describe("rate-limit headers (C130)", () => {
  it("reports the token headers of every response to the pacer, via withResponse", async () => {
    const observed: unknown[] = [];
    const client: ChatCompletionsClient = {
      chat: {
        completions: {
          create: () => {
            const data = { choices: [{ message: { content: "ok" } }] };
            return Object.assign(Promise.resolve(data), {
              withResponse: async () => ({
                data,
                response: {
                  headers: new Headers({ "x-ratelimit-remaining-tokens": "700", "x-ratelimit-reset-tokens": "3s" }),
                },
              }),
            });
          },
        },
      },
    };
    const pacer = { observeHeaders: (h: unknown) => void observed.push(h), observeRequestsPerMinute: () => {} };
    await expect(createOpenAiCompatibleLlm({ ...config, pacer }, client).chat(messages)).resolves.toBe("ok");
    expect(observed).toEqual([{ remainingTokens: 700, resetTokensMs: 3_000 }]);
  });

  it("tells the pacer the requests/minute limit a 429 states, and the headers it carried", async () => {
    const limits: number[] = [];
    const snapshots: unknown[] = [];
    let calls = 0;
    const client: ChatCompletionsClient = {
      chat: {
        completions: {
          create: async () => {
            calls += 1;
            if (calls === 1) {
              throw APIError.generate(
                429,
                undefined,
                "on requests per minute (RPM): Limit 30, Used 30, Requested 1. Please try again in 1s.",
                new Headers({ "x-ratelimit-remaining-tokens": "8000", "x-ratelimit-reset-tokens": "0s" }),
              );
            }
            return { choices: [{ message: { content: "ok" } }] };
          },
        },
      },
    };
    const pacer = {
      observeHeaders: (h: unknown) => void snapshots.push(h),
      observeRequestsPerMinute: (n: number) => void limits.push(n),
    };
    const { sleep } = fakeClock();
    await expect(createOpenAiCompatibleLlm({ ...config, pacer }, client, sleep).chat(messages)).resolves.toBe("ok");
    expect(limits).toEqual([30]);
    expect(snapshots).toEqual([{ remainingTokens: 8_000, resetTokensMs: 0 }]);
  });
});

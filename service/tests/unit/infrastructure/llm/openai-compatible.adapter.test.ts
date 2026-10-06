import { APIError } from "openai";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../../../src/application/ports/llm.port";
import { LLM } from "../../../../src/config/constants";
import { QuotaExhaustedError } from "../../../../src/domain/errors/quota-exhausted.error";
import { fakeClock } from "../../../fixtures/fake-clock";
import {
  type ChatCompletionsClient,
  createOpenAiCompatibleLlm,
  type OpenAiCompatibleConfig,
} from "../../../../src/infrastructure/llm/openai-compatible.adapter";

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
});

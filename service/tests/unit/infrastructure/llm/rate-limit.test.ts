import { APIConnectionError, APIConnectionTimeoutError, APIError } from "openai";
import { describe, expect, it } from "vitest";
import { LLM } from "../../../../src/config/constants";
import { bodyRetryAfterMs, classifyLlmError } from "../../../../src/infrastructure/llm/rate-limit";

// Bodies modelled on what the three free-tier providers actually return.
const geminiDaily = {
  status: 429,
  message: "Resource has been exhausted (e.g. check quota).",
  error: {
    details: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }],
  },
};
const groqDaily = {
  status: 429,
  message: "Rate limit reached for model `llama-3.3-70b` : Limit 1000, Used 1000. Limit requests per day.",
};
const openRouterDaily = {
  status: 429,
  message: "Rate limit exceeded: free-models-per-day",
};
const burst = {
  status: 429,
  message: "Rate limit reached: 5 requests per minute. Please try again shortly.",
  headers: { "retry-after": "12" },
};

// The exact body Gemini returned during the Phase 6 smoke run: a per-MINUTE limit that mentions both a
// quota and a long retry delay, and so is the likeliest thing to be misread as a daily cap.
const geminiPerMinuteLive = {
  status: 429,
  message:
    "429 You exceeded your current quota, please check your plan and billing details. " +
    "* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, " +
    "limit: 5, model: gemini-3.6-flash. Please retry in 41.715953618s.",
  error: {
    details: [
      { quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier", quotaValue: "5" },
      { retryDelay: "41s" },
    ],
  },
};

// Everything above is a hand-built plain object, which is exactly how a real bug hid here: the SDK sets
// APIError.headers to a `Headers` INSTANCE, zod rejected it, the whole safeParse failed, and `status`
// came back undefined - so every daily-quota 429 was silently downgraded to "retryable" and every node
// burned six retries against a quota that was already gone. These cases go through the real SDK
// constructor so the shape under test is the shape production throws (docs/conflicts.md C56).
function sdkError(status: number, body: object, headers: Record<string, string> = {}): APIError {
  return APIError.generate(status, body, `${status} ${JSON.stringify(body)}`, new Headers(headers));
}

const liveGeminiDailyBody = [
  {
    error: {
      code: 429,
      message:
        "You exceeded your current quota, please check your plan and billing details. " +
        "* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, " +
        "limit: 20, model: gemini-3.6-flash. Please retry in 37.12947044s.",
      status: "RESOURCE_EXHAUSTED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }],
        },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "37s" },
      ],
    },
  },
];

describe("classifyLlmError, on errors the SDK really throws", () => {
  it("reads the status through a Headers instance instead of losing the whole parse", () => {
    const classified = classifyLlmError(sdkError(429, liveGeminiDailyBody, { "content-type": "application/json" }));
    expect(classified.status).toBe(429);
  });

  it("classifies the live Gemini daily 429 as a daily quota", () => {
    // The exact body from the failing `smoke:node -- "teach me unix" 3` run.
    expect(classifyLlmError(sdkError(429, liveGeminiDailyBody)).kind).toBe("daily-quota");
  });

  it("calls it daily even though the wait it asks for is short", () => {
    // 37s is far under DAILY_QUOTA_RETRY_AFTER_MS, so the wording is the only tell. Requiring BOTH the
    // long wait and the wording would put the C50 fail-fast back out of reach.
    const classified = classifyLlmError(sdkError(429, liveGeminiDailyBody));
    expect(classified.retryAfterMs).toBeLessThan(LLM.DAILY_QUOTA_RETRY_AFTER_MS);
    expect(classified.kind).toBe("daily-quota");
  });

  it("still reads a real per-minute 429 as retryable", () => {
    const perMinute = [
      {
        error: {
          message: "Quota exceeded. limit: 5, model: gemini-3.6-flash. Please retry in 41.7s.",
          details: [{ violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] }],
        },
      },
    ];
    expect(classifyLlmError(sdkError(429, perMinute)).kind).toBe("retryable");
  });

  it("never retries a bad key that arrives as a real SDK error", () => {
    expect(classifyLlmError(sdkError(401, { error: { message: "invalid api key" } })).kind).toBe("fatal");
  });
});

describe("bodyRetryAfterMs", () => {
  // Gemini states its wait in the BODY (google.rpc.RetryInfo), never in a retry-after header, so without
  // this the adapter fell back to its own guess and retried inside the window it was told to wait out.
  it("reads google.rpc.RetryInfo out of the response body", () => {
    expect(bodyRetryAfterMs('{"@type":"...RetryInfo","retryDelay":"37s"}')).toBe(37_000);
  });

  it("falls back to the prose the message carries", () => {
    expect(bodyRetryAfterMs("Please retry in 41.715953618s.")).toBe(41_716);
  });

  it("is undefined when the body names no wait at all", () => {
    expect(bodyRetryAfterMs("Resource has been exhausted.")).toBeUndefined();
  });

  it("is used only when no retry-after header is present", () => {
    const withHeader = sdkError(429, [{ error: { message: "Please retry in 41.7s." } }], { "retry-after": "3" });
    expect(classifyLlmError(withHeader).retryAfterMs).toBe(3_000);
    const withoutHeader = sdkError(429, [{ error: { message: "Please retry in 41.7s." } }]);
    expect(classifyLlmError(withoutHeader).retryAfterMs).toBe(41_700);
  });
});

describe("classifyLlmError", () => {
  it("treats Gemini's real per-minute 429 as retryable, not as a daily cap", () => {
    // Misreading this would halt the worker on a limit that clears in under a minute.
    expect(classifyLlmError(geminiPerMinuteLive).kind).toBe("retryable");
  });

  it("recognises each provider's daily quota", () => {
    for (const error of [geminiDaily, groqDaily, openRouterDaily]) {
      expect(classifyLlmError(error).kind).toBe("daily-quota");
    }
  });

  it("treats a per-minute 429 as retryable and reads its retry-after", () => {
    const classified = classifyLlmError(burst);
    expect(classified.kind).toBe("retryable");
    expect(classified.retryAfterMs).toBe(12_000);
  });

  it("calls a 429 daily whenever the wait it asks for outlasts any backoff", () => {
    // Provider-agnostic backstop, for wording the regex does not know.
    const long = { status: 429, message: "slow down", headers: { "retry-after-ms": String(LLM.DAILY_QUOTA_RETRY_AFTER_MS + 1) } };
    expect(classifyLlmError(long).kind).toBe("daily-quota");
    const short = { status: 429, message: "slow down", headers: { "retry-after-ms": "2000" } };
    expect(classifyLlmError(short).kind).toBe("retryable");
  });

  it("never retries a bad key", () => {
    expect(classifyLlmError({ status: 401, message: "invalid api key" }).kind).toBe("fatal");
    expect(classifyLlmError({ status: 403, message: "forbidden" }).kind).toBe("fatal");
  });

  it("retries what the SERVER failed at, and separates it from what never reached the server", () => {
    expect(classifyLlmError({ status: 503, message: "overloaded" }).kind).toBe("retryable");
    expect(classifyLlmError({ status: 408, message: "timeout" }).kind).toBe("retryable");
    // Changed deliberately in C94: this used to be "retryable" like a 503, which is what let a
    // ~1-minute outage burn every receive and dead-letter 14 articles.
    expect(classifyLlmError(new Error("ECONNRESET")).kind).toBe("network");
  });

  describe("a request that never reached the provider (C94)", () => {
    // The distinction the whole stall path rests on: a 5xx is the SERVER failing, a connection error is
    // the request never arriving. The SDK funnels every pre-HTTP failure into APIConnectionError with
    // `status: undefined`, which used to make it indistinguishable from "overloaded".
    const socketError = (code: string) => Object.assign(new Error(`connect ${code} 1.2.3.4:443`), { code });

    it("classifies the SDK's own connection errors, cause and all", () => {
      const connection = classifyLlmError(new APIConnectionError({ cause: socketError("ECONNRESET") }));
      expect(connection.kind).toBe("network");
      // The cause IS the diagnosis: "Connection error." alone never says what gave way.
      expect(connection.detail).toContain("ECONNRESET");
      expect(connection.status).toBeUndefined();

      // The 60 s client-side abort, which carries no cause at all.
      expect(classifyLlmError(new APIConnectionTimeoutError({})).kind).toBe("network");
    });

    it("classifies undici's bare fetch failure, whose code is one level down", () => {
      const fetchFailed = Object.assign(new TypeError("fetch failed"), {
        cause: socketError("UND_ERR_CONNECT_TIMEOUT"),
      });
      const classified = classifyLlmError(fetchFailed);
      expect(classified.kind).toBe("network");
      expect(classified.detail).toContain("UND_ERR_CONNECT_TIMEOUT");
    });

    it("recognises every socket code the build has actually seen, wherever it is written", () => {
      for (const code of ["ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ETIMEDOUT"]) {
        expect(classifyLlmError(new APIConnectionError({ cause: socketError(code) })).kind).toBe("network");
        // Some layers only put the code in the message, so both are read.
        expect(classifyLlmError(new Error(`getaddrinfo ${code} api.groq.com`)).kind).toBe("network");
      }
    });

    it("never calls a real HTTP response a network fault, whatever its body says", () => {
      // The guard against over-matching: a 503 whose body happens to mention a socket code is still the
      // server answering, and must keep the retry semantics C50/C68 tuned on it.
      expect(classifyLlmError({ status: 503, message: "upstream ECONNRESET" }).kind).toBe("retryable");
      expect(classifyLlmError(APIError.generate(500, undefined, "boom", new Headers())).kind).toBe("retryable");
      expect(classifyLlmError(new Error("LLM returned no content")).kind).toBe("retryable");
    });
  });

  it("does not retry a request the server rejected on its merits", () => {
    expect(classifyLlmError({ status: 400, message: "bad request" }).kind).toBe("fatal");
    expect(classifyLlmError({ status: 404, message: "no such model" }).kind).toBe("fatal");
  });

  // The single load-bearing assumption behind model rotation: Groq's per-MINUTE token limit must read as
  // retryable with its stated sub-second wait. C56 is the cautionary tale of an untested classification
  // silently inverting, so this pins the body Groq actually returned during a real depth-2 build.
  // Groq words its wait differently from Gemini ("try again in", and sometimes in MILLISECONDS). Reading
  // it wrong is not harmless: the model pool then shelves a member for a flat DEFAULT_COOLDOWN_MS when
  // the server asked for less, throttling a build that could have continued.
  it("reads Groq's 'try again in' wait, in seconds and in milliseconds", () => {
    expect(bodyRetryAfterMs("... (RPM): Limit 30, Used 30. Please try again in 2s.")).toBe(2_000);
    expect(bodyRetryAfterMs("... (TPM): Limit 8000, Used 7157. Please try again in 787.5ms.")).toBe(788);
    expect(bodyRetryAfterMs("Please try again in 4.2375s.")).toBe(4_238);
  });

  it("still prefers the structured retryDelay over prose when both are present", () => {
    const body = '{"retryDelay":"37s"} ... Please try again in 2s.';
    expect(bodyRetryAfterMs(body)).toBe(37_000);
  });

  it("classifies Groq's live tokens-per-minute 429 as retryable with its stated wait", () => {
    const groqTpmLive = sdkError(429, {
      error: {
        message:
          "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01m2` service tier " +
          "`on_demand` on tokens per minute (TPM): Limit 8000, Used 7157, Requested 948. " +
          "Please try again in 787.5ms. Need more tokens? Upgrade to Dev Tier today.",
        type: "tokens",
        code: "rate_limit_exceeded",
      },
    });
    const classified = classifyLlmError(groqTpmLive);
    expect(classified.kind).toBe("retryable");
    expect(classified.status).toBe(429);
  });

  // Groq's server-side JSON-mode validator rejecting the MODEL's malformed output. Reproduced live ~1 in
  // 8 on qwen/qwen3.8-27b with the real expand prompt. Fatal would burn all three queue redeliveries and
  // dead-letter a node that a re-roll (or another pool member) answers correctly.
  it("retries a 400 json_validate_failed, because that is a bad sample, not a bad request", () => {
    const jsonValidateFailed = sdkError(400, {
      error: {
        message: "Failed to generate JSON. Please adjust your prompt. See 'failed_generation' for details.",
        type: "invalid_request_error",
        code: "json_validate_failed",
        failed_generation: '{"brief": string, "children": string[]}"\n2.  **Context',
      },
    });
    expect(classifyLlmError(jsonValidateFailed).kind).toBe("retryable");
  });

  it("keeps every other 400 fatal, including one carrying an unrelated code", () => {
    expect(classifyLlmError({ status: 400, message: "bad request" }).kind).toBe("fatal");
    expect(
      classifyLlmError({ status: 400, error: { code: "context_length_exceeded" }, message: "too long" }).kind,
    ).toBe("fatal");
  });
});

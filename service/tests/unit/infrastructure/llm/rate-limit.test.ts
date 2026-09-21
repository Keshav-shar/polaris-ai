import { APIError } from "openai";
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

  it("retries server errors, timeouts and bare network failures", () => {
    expect(classifyLlmError({ status: 503, message: "overloaded" }).kind).toBe("retryable");
    expect(classifyLlmError({ status: 408, message: "timeout" }).kind).toBe("retryable");
    expect(classifyLlmError(new Error("ECONNRESET")).kind).toBe("retryable");
  });

  it("does not retry a request the server rejected on its merits", () => {
    expect(classifyLlmError({ status: 400, message: "bad request" }).kind).toBe("fatal");
    expect(classifyLlmError({ status: 404, message: "no such model" }).kind).toBe("fatal");
  });
});

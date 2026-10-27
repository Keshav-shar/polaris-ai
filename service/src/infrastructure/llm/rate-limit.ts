import { z } from "zod";
import { LLM } from "../../config/constants";
import { transportFaultCode } from "../../shared/transport-fault";

export type LlmErrorKind = "daily-quota" | "network" | "retryable" | "fatal";

export type LlmErrorClass = {
  kind: LlmErrorKind;
  status?: number;
  retryAfterMs?: number;
  detail: string;
  // Set on a daily-quota 429 whose wording names the limit (C119).
  dailyLimit?: "tokens" | "requests";
  // Set on a per-minute 429 that states the model's requests/minute limit, which Groq says nowhere else (C130).
  requestsPerMinuteLimit?: number;
};

// Groq: "... on tokens per day (TPD): Limit 200000 ..." / "... on requests per day (RPD) ...".
const TOKENS_PER_DAY = /tokens\s+per\s+day|\bTPD\b/i;
const REQUESTS_PER_DAY = /requests\s+per\s+day|\bRPD\b|RequestsPerDay/i;
// Groq: "... on requests per minute (RPM): Limit 30, Used 30, Requested 1. Please try again in 2s."
const REQUESTS_PER_MINUTE_LIMIT = /requests\s+per\s+minute(?:\s*\(RPM\))?\s*:\s*Limit\s+(\d+)/i;

// The SDK hands us a `Headers` instance, not a plain object, and zod rejects it outright. Normalising
// first is what keeps `status` readable at all: a single rejected field used to fail the whole parse and
// silently downgrade every daily-quota 429 to a retryable one (docs/conflicts.md C56).
const HeaderBag = z.preprocess(
  (h) => (h instanceof Headers ? Object.fromEntries(h.entries()) : h),
  z.record(z.string(), z.unknown()).optional(),
);

// The slice of an OpenAI SDK APIError we can rely on across providers. Parsed rather than cast: the value
// crosses a trust boundary (it is whatever the transport threw). Every field catches its own failure, so
// one unexpected shape can never blank out the others.
const ApiErrorShape = z.object({
  status: z.number().int().optional().catch(undefined),
  name: z.string().optional().catch(undefined),
  message: z.string().optional().catch(undefined),
  headers: HeaderBag.catch(undefined),
  error: z.unknown().optional().catch(undefined),
});

// Daily-quota wording. Groq says "requests per day"; the other spellings are recorded from providers this
// project has actually run on, and are KEPT as a backstop rather than deleted with the second profile
// (C93) - the cost is a regex branch, and the failure they prevent is a whole run of wasted requests.
const DAILY_QUOTA = /per[\s_-]*day|\bdaily\b|RequestsPerDay|free-models-per-day|\bRPD\b|\bTPD\b/i;

// Some providers put the wait in the BODY (google.rpc.RetryInfo) rather than a retry-after header: as
// JSON when the details survive, as prose in the message otherwise. Recorded from a real payload.
const BODY_RETRY_DELAY = /"retryDelay"\s*:\s*"?(\d+(?:\.\d+)?)s"?/i;
// Both wordings seen live: "Please retry in 41.7s", and Groq's "Please try again in 2s" and
// "...in 787.5ms". Missing Groq's phrasing is not harmless - the pool then falls back to a flat
// DEFAULT_COOLDOWN_MS and shelves a member for 5s when the server asked for 2s, throttling the build.
const PROSE_RETRY_DELAY = /(?:retry|try\s+again)\s+in\s+(\d+(?:\.\d+)?)\s*(ms|s)\b/i;

// Providers put a machine-readable reason in `error.code`. Parsed, not cast: `error` is `unknown` here.
const ErrorCodeShape = z.object({ code: z.string().optional().catch(undefined) });

// The SDK's own classes for "the request never completed". Matched by NAME rather than `instanceof`:
// `openai` is imported in exactly one adapter, and an instanceof across two copies of a package fails
// silently - the failure mode this check exists to catch in the first place.
const CONNECTION_CLASS = /^APIConnection(Timeout)?Error$/;

function errorCode(error: unknown): string | undefined {
  const parsed = ErrorCodeShape.safeParse(error);
  return parsed.success ? parsed.data.code : undefined;
}

function headerNumber(headers: Record<string, unknown> | undefined, name: string): number | undefined {
  const raw = headers?.[name] ?? headers?.[name.toLowerCase()];
  if (typeof raw !== "string" && typeof raw !== "number") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function headerRetryAfterMs(headers: Record<string, unknown> | undefined): number | undefined {
  const ms = headerNumber(headers, "retry-after-ms");
  if (ms !== undefined) return ms;
  const seconds = headerNumber(headers, "retry-after");
  return seconds === undefined ? undefined : seconds * 1000;
}

// Exported for its own test: the body is the only place some providers state their wait.
export function bodyRetryAfterMs(body: string): number | undefined {
  const structured = BODY_RETRY_DELAY.exec(body);
  if (structured?.[1] !== undefined) {
    const seconds = Number(structured[1]);
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
  }
  const prose = PROSE_RETRY_DELAY.exec(body);
  if (prose?.[1] === undefined) return undefined;
  const value = Number(prose[1]);
  if (!Number.isFinite(value)) return undefined;
  // Group 2 is the unit: "ms" is already milliseconds, "s" needs scaling.
  return Math.round(prose[2]?.toLowerCase() === "ms" ? value : value * 1000);
}

// Decides whether an error is worth another attempt. A daily quota is reported separately because no
// backoff inside this process can outlast it: retrying is pure waste of a free-tier request.
export function classifyLlmError(error: unknown): LlmErrorClass {
  const parsed = ApiErrorShape.safeParse(error);
  const shape = parsed.success ? parsed.data : {};
  const detail = shape.message ?? (error instanceof Error ? error.message : String(error));
  const { status } = shape;

  // BEFORE the status checks, because a transport fault has no status and would otherwise land in the
  // `status === undefined` bucket below and be treated exactly like a 503 - retried against every model
  // in turn, then counted against the node. It is neither the server's fault nor the node's.
  const className = error instanceof Error ? error.constructor.name : "";
  const isConnectionClass = CONNECTION_CLASS.test(className) || CONNECTION_CLASS.test(shape.name ?? "");
  const fault = transportFaultCode(error);
  if (status === undefined && (isConnectionClass || fault !== undefined)) {
    // The cause is the diagnosis: "Connection error." alone never says whether DNS, the socket or the
    // client timeout gave way.
    const named = fault === undefined || detail.includes(fault) ? detail : `${detail} (${fault})`;
    return { kind: "network", detail: named };
  }

  if (status === 429) {
    const body = `${detail} ${JSON.stringify(shape.error ?? "")}`;
    const after = headerRetryAfterMs(shape.headers) ?? bodyRetryAfterMs(body);
    // OR, not AND: an exhausted daily quota often asks for a SHORT wait (4s and 37s both observed live),
    // so the wording is the only tell. Requiring both would put the C50 fail-fast back out of reach.
    const daily = (after !== undefined && after > LLM.DAILY_QUOTA_RETRY_AFTER_MS) || DAILY_QUOTA.test(body);
    if (!daily) {
      const rpm = Number(REQUESTS_PER_MINUTE_LIMIT.exec(body)?.[1]);
      return {
        kind: "retryable",
        status,
        retryAfterMs: after,
        detail,
        ...(Number.isInteger(rpm) && rpm > 0 ? { requestsPerMinuteLimit: rpm } : {}),
      };
    }
    const dailyLimit = TOKENS_PER_DAY.test(body) ? "tokens" : REQUESTS_PER_DAY.test(body) ? "requests" : undefined;
    return { kind: "daily-quota", status, retryAfterMs: after, detail, ...(dailyLimit === undefined ? {} : { dailyLimit }) };
  }
  // Groq's server-side JSON-mode validator rejects the MODEL's own malformed output with a 400
  // `json_validate_failed`, carrying the bad text in `failed_generation` (observed ~1 in 8 on
  // qwen/qwen3.8-27b with the real expand prompt). That is a bad SAMPLE, not a bad request: it is exactly
  // what the repair loop in application/llm/structured.ts exists for, but it arrives as an HTTP error, so
  // the repair loop never sees it. Left fatal, the node instead burns all QUEUE.MAX_RECEIVES redeliveries
  // and dead-letters. Re-rolling usually succeeds; in a model pool another member usually succeeds at
  // once. Every OTHER 400 stays fatal - a malformed request would fail identically on every retry.
  if (status === 400 && errorCode(shape.error) === "json_validate_failed") {
    return { kind: "retryable", status, detail };
  }
  // A bad key must never burn retries or queue redeliveries.
  if (status === 401 || status === 403) return { kind: "fatal", status, detail };
  if (status === undefined || status >= 500 || status === 408 || status === 409) {
    return { kind: "retryable", status, detail };
  }
  return { kind: "fatal", status, detail };
}

// An optional request parameter this model rejects. Each maps to one ChatOptions field the adapter can stop
// sending for that model, so one rejection costs one request instead of failing every call (C113, C114).
export type OptionalFeature = "responseSchema" | "reasoningEffort" | "maxCompletionTokens";

// Recorded live 2026-10-07 from Groq: `400 \`reasoning_effort\` must be one of \`low\`, \`medium\`, or
// \`high\``, and `400 invalid JSON schema for response_format: ...`. Keyed on the PARAMETER NAME in the
// message, which is what any OpenAI-compatible provider has to say to be understood. A 400
// `json_validate_failed` is the model's own bad sample (C70), never an unsupported feature.
const FEATURE_PARAMS: readonly { feature: OptionalFeature; pattern: RegExp }[] = [
  { feature: "reasoningEffort", pattern: /reasoning_effort/i },
  { feature: "maxCompletionTokens", pattern: /max_completion_tokens/i },
  { feature: "responseSchema", pattern: /json_schema|response_format/i },
];

export function unsupportedFeature(error: unknown): OptionalFeature | undefined {
  const parsed = ApiErrorShape.safeParse(error);
  if (!parsed.success || parsed.data.status !== 400) return undefined;
  if (errorCode(parsed.data.error) === "json_validate_failed") return undefined;
  const text = `${parsed.data.message ?? ""} ${JSON.stringify(parsed.data.error ?? "")}`;
  return FEATURE_PARAMS.find(({ pattern }) => pattern.test(text))?.feature;
}

// What a provider says about a model's per-minute TOKEN budget on every response. On Groq,
// `x-ratelimit-remaining-tokens` / `x-ratelimit-reset-tokens` are per MINUTE while the `*-requests` pair is per
// DAY, so only the token pair is read for pacing (C130).
// `limitTokens` (the bucket's size) is optional: with it the pacer can model the refill, without it it waits
// for the full reset.
export type RateHeaders = { remainingTokens: number; resetTokensMs: number; limitTokens?: number };

// Groq writes durations as "7.66s", "2m59.56s", "1h2m3s" or "120ms".
const DURATION_PART = /(\d+(?:\.\d+)?)(ms|h|m|s)/gi;
const UNIT_MS: Readonly<Record<string, number>> = { h: 3_600_000, m: 60_000, s: 1_000, ms: 1 };

export function parseDurationMs(raw: string): number | undefined {
  const text = raw.trim();
  if (text === "") return undefined;
  // A bare number is seconds, as `retry-after` is.
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  let total = 0;
  let consumed = 0;
  for (const match of text.matchAll(DURATION_PART)) {
    const value = Number(match[1]);
    const unit = UNIT_MS[match[2]?.toLowerCase() ?? ""];
    if (!Number.isFinite(value) || unit === undefined) return undefined;
    total += value * unit;
    consumed += match[0].length;
  }
  // Anything left over means a format this parser does not know; guessing would pace on a wrong number.
  return consumed === text.length ? Math.round(total) : undefined;
}

// Parsed, not cast: headers cross a trust boundary like the body does. Undefined unless BOTH are readable.
export function parseRateHeaders(headers: unknown): RateHeaders | undefined {
  const parsed = HeaderBag.safeParse(headers);
  const bag = parsed.success ? parsed.data : undefined;
  const remainingTokens = headerNumber(bag, "x-ratelimit-remaining-tokens");
  const reset = bag?.["x-ratelimit-reset-tokens"];
  const resetTokensMs = typeof reset === "string" ? parseDurationMs(reset) : undefined;
  if (remainingTokens === undefined || remainingTokens < 0 || resetTokensMs === undefined) return undefined;
  const limitTokens = headerNumber(bag, "x-ratelimit-limit-tokens");
  return {
    remainingTokens,
    resetTokensMs,
    ...(limitTokens !== undefined && limitTokens >= remainingTokens && limitTokens > 0 ? { limitTokens } : {}),
  };
}

const WithHeaders = z.object({ headers: z.unknown() });

// The same snapshot from a failed request: Groq sends its rate headers with a 429 too, and that is exactly the
// moment the pacer most needs them.
export function rateHeadersOfError(error: unknown): RateHeaders | undefined {
  const parsed = WithHeaders.safeParse(error);
  return parsed.success ? parseRateHeaders(parsed.data.headers) : undefined;
}

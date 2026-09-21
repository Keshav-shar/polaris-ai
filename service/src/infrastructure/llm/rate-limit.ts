import { z } from "zod";
import { LLM } from "../../config/constants";

export type LlmErrorKind = "daily-quota" | "retryable" | "fatal";

export type LlmErrorClass = {
  kind: LlmErrorKind;
  status?: number;
  retryAfterMs?: number;
  detail: string;
};

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
  message: z.string().optional().catch(undefined),
  headers: HeaderBag.catch(undefined),
  error: z.unknown().optional().catch(undefined),
});

// Daily-quota wording, by provider: Gemini "GenerateRequestsPerDayPerProjectPerModel", Groq "requests per
// day", OpenRouter "free-models-per-day". The retry-after rule below is the provider-agnostic backstop.
const DAILY_QUOTA = /per[\s_-]*day|\bdaily\b|RequestsPerDay|free-models-per-day|\bRPD\b|\bTPD\b/i;

// Gemini puts its wait in the BODY (google.rpc.RetryInfo), never in a retry-after header: as JSON when the
// details survive, as prose in the message otherwise.
const BODY_RETRY_DELAY = /"retryDelay"\s*:\s*"?(\d+(?:\.\d+)?)s"?/i;
const PROSE_RETRY_DELAY = /retry\s+in\s+(\d+(?:\.\d+)?)\s*s/i;

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
  const match = BODY_RETRY_DELAY.exec(body) ?? PROSE_RETRY_DELAY.exec(body);
  if (match?.[1] === undefined) return undefined;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
}

// Decides whether an error is worth another attempt. A daily quota is reported separately because no
// backoff inside this process can outlast it: retrying is pure waste of a free-tier request.
export function classifyLlmError(error: unknown): LlmErrorClass {
  const parsed = ApiErrorShape.safeParse(error);
  const shape = parsed.success ? parsed.data : {};
  const detail = shape.message ?? (error instanceof Error ? error.message : String(error));
  const { status } = shape;

  if (status === 429) {
    const body = `${detail} ${JSON.stringify(shape.error ?? "")}`;
    const after = headerRetryAfterMs(shape.headers) ?? bodyRetryAfterMs(body);
    // OR, not AND: an exhausted daily quota often asks for a SHORT wait (4s, 37s observed on Gemini),
    // so the wording is the only tell. Requiring both would put the C50 fail-fast back out of reach.
    const daily = (after !== undefined && after > LLM.DAILY_QUOTA_RETRY_AFTER_MS) || DAILY_QUOTA.test(body);
    return { kind: daily ? "daily-quota" : "retryable", status, retryAfterMs: after, detail };
  }
  // A bad key must never burn retries or queue redeliveries.
  if (status === 401 || status === 403) return { kind: "fatal", status, detail };
  if (status === undefined || status >= 500 || status === 408 || status === 409) {
    return { kind: "retryable", status, detail };
  }
  return { kind: "fatal", status, detail };
}

import { z } from "zod";
import { LLM } from "../../config/constants";

export type LlmErrorKind = "daily-quota" | "network" | "retryable" | "fatal";

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

// A transport fault carries its diagnosis in `cause`, one or two levels down: the OpenAI SDK wraps the
// real error ("Connection error." + cause), and undici wraps its own ("fetch failed" + cause with a code).
const CauseShape = z.object({
  name: z.string().optional().catch(undefined),
  message: z.string().optional().catch(undefined),
  code: z.string().optional().catch(undefined),
  errno: z.number().optional().catch(undefined),
  cause: z.unknown().optional().catch(undefined),
});

// Node/undici socket-level codes. `UND_ERR_` covers undici's own family (CONNECT_TIMEOUT, SOCKET, ...).
const SOCKET_CODE = /^(ECONNRESET|ECONNREFUSED|ECONNABORTED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|EHOSTUNREACH|ENETUNREACH|EHOSTDOWN|ECANCELED|CERT_|UND_ERR_)/;

// The SDK's own classes for "the request never completed". Matched by NAME rather than `instanceof`:
// `openai` is imported in exactly one adapter, and an instanceof across two copies of a package fails
// silently - the failure mode this check exists to catch in the first place.
const CONNECTION_CLASS = /^APIConnection(Timeout)?Error$/;

// The socket code, wherever it is: on the error itself, on any `cause` below it, or spelled out in a
// message (`connect ECONNREFUSED 127.0.0.1:443`). Bounded walk, because a cause chain is untrusted input.
function socketCodeIn(text: string): string | undefined {
  return text.split(/[^A-Z_]+/).find((token) => token.length > 3 && SOCKET_CODE.test(token));
}

function transportFault(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth++) {
    const parsed = CauseShape.safeParse(current);
    if (!parsed.success) return undefined;
    const { message, code, cause } = parsed.data;
    if (code !== undefined && SOCKET_CODE.test(code)) return code;
    const fromMessage = message === undefined ? undefined : socketCodeIn(message);
    if (fromMessage !== undefined) return fromMessage;
    current = cause;
  }
  return undefined;
}

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
  const fault = transportFault(error);
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
    return { kind: daily ? "daily-quota" : "retryable", status, retryAfterMs: after, detail };
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

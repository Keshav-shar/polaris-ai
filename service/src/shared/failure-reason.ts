import { redactSecrets } from "./redact";

// One readable line for why something failed, stored and shown instead of a stack trace - the same
// contract `Run.haltReason` already has (domain/schemas/run.schema.ts).
//
// The error's NAME carries most of the diagnostic value here: `StructuredOutputError` (the model never
// produced valid output), `QuotaExhaustedError` and a transport 429 need completely different fixes, and
// the message alone does not always say which one happened.
//
// Truncated, because this is a line in an API response, not a log: an SDK error can carry an entire
// response body in its message. Redacted, because a provider may echo the request - including its key -
// back in that body, and this string reaches the UI.
const MAX_CHARS = 300;

// The OpenAI SDK never assigns `name` on its error classes (node_modules/openai/core/error.js), so an
// `APIConnectionError` arrives with the inherited "Error" and the stored reason read `Error: Connection
// error.` - the one thing it needed to say was missing. The constructor name is what the class actually
// is, so prefer it whenever `name` has been left at the default.
function nameOf(error: Error): string {
  const constructorName = error.constructor.name;
  return error.name === "Error" && constructorName !== "" ? constructorName : error.name;
}

// One level of `cause`, because that is where a transport fault keeps its diagnosis (`ECONNRESET`,
// `UND_ERR_CONNECT_TIMEOUT`). Not the whole chain: this is a single line, not a stack.
function causeOf(error: Error): string | undefined {
  const { cause } = error;
  if (cause === undefined || cause === null) return undefined;
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    return typeof code === "string" && code !== "" ? code : `${nameOf(cause)}: ${cause.message}`;
  }
  return typeof cause === "string" ? cause : undefined;
}

export function failureReason(error: unknown, secrets: readonly (string | undefined)[] = []): string {
  let raw: string;
  if (error instanceof Error) {
    const cause = causeOf(error);
    raw = `${nameOf(error)}: ${error.message}`;
    if (cause !== undefined && !raw.includes(cause)) raw += ` (${cause})`;
  } else {
    raw = String(error);
  }
  const safe = redactSecrets(raw, secrets);
  const collapsed = safe.replace(/\s+/g, " ").trim();
  return collapsed.length <= MAX_CHARS ? collapsed : `${collapsed.slice(0, MAX_CHARS - 1)}…`;
}

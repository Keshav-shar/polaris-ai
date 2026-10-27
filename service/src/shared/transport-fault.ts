// Recognises "the request never completed" - DNS, socket, TLS, or a client-side timeout - in any error an
// HTTP client throws, and names the fault. Shared by the LLM adapter and the search adapters, because the
// rule is about the TRANSPORT, not about who was being called: a fault like this says nothing about the
// node being worked on, so the queue must not count it against that node (docs/conflicts.md C94, C115).
//
// Standard library only: the error is untrusted input, so it is narrowed field by field rather than cast.

// Node/undici socket-level codes. `UND_ERR_` covers undici's own family (CONNECT_TIMEOUT, SOCKET, ...).
const SOCKET_CODE =
  /^(ECONNRESET|ECONNREFUSED|ECONNABORTED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPIPE|EHOSTUNREACH|ENETUNREACH|EHOSTDOWN|ECANCELED|CERT_|UND_ERR_)/;

// What `AbortSignal.timeout()` throws when it fires (a DOMException). Our own timeout, not the server's.
const TIMEOUT_NAME = "TimeoutError";

// How far down a `cause` chain to look. The OpenAI SDK wraps the real error once ("Connection error." +
// cause) and undici wraps its own again ("fetch failed" + cause with a code); four levels covers both
// with room, and bounds a walk over input we do not control.
const MAX_CAUSE_DEPTH = 4;

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const raw = field(value, key);
  return typeof raw === "string" ? raw : undefined;
}

// A code spelled out in a message: `connect ECONNREFUSED 127.0.0.1:443`.
function socketCodeIn(text: string): string | undefined {
  return text.split(/[^A-Z_]+/).find((token) => token.length > 3 && SOCKET_CODE.test(token));
}

// The fault's name (`ECONNRESET`, `UND_ERR_CONNECT_TIMEOUT`, `TimeoutError`), wherever it sits: on the error
// itself, on any `cause` below it, or in a message. undefined when the error is not a transport fault -
// in particular when it carries an HTTP status, because then the server DID answer.
export function transportFaultCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current !== undefined && current !== null; depth++) {
    if (stringField(current, "name") === TIMEOUT_NAME) return TIMEOUT_NAME;
    const code = stringField(current, "code");
    if (code !== undefined && SOCKET_CODE.test(code)) return code;
    const message = stringField(current, "message");
    const fromMessage = message === undefined ? undefined : socketCodeIn(message);
    if (fromMessage !== undefined) return fromMessage;
    current = field(current, "cause");
  }
  return undefined;
}

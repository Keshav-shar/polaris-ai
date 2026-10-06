import { DomainError } from "./domain-error";

// The HTTP request never completed: DNS, socket, TLS, or the client's own timeout. There is no status
// code, because no response was ever received - which is exactly what separates this from a 5xx.
//
// It is raised as its own error, rather than left in the generic retryable bucket, because the two
// layers above it must treat it differently from a server-side failure:
//
//   - the model pool must NOT rotate. Every member shares one transport, so shelving them one at a time
//     spends the whole attempt budget to learn the same thing once per model.
//   - the queue consumer must NOT count it against the node. A ~1-minute network blip burned all three
//     receives in seconds and permanently dead-lettered 14 articles in the 2026-09-24 run; a stall is
//     not the node's fault (docs/conflicts.md C94).
export class TransportUnavailableError extends DomainError {
  readonly code = "TRANSPORT_UNAVAILABLE";

  constructor(
    readonly target: string,
    // The underlying fault, already redacted and collapsed by the caller: `ECONNRESET`, `ENOTFOUND`,
    // `UND_ERR_CONNECT_TIMEOUT`. Without it the stored reason is the SDK's bare "Connection error.",
    // which says a request failed and nothing about why.
    readonly detail: string,
  ) {
    super(`Cannot reach the LLM provider (${target}): ${detail}`);
  }
}

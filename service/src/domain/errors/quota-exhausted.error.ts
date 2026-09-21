import { DomainError } from "./domain-error";

// The provider's DAILY quota is gone: no backoff inside this process can outlast it. Per-minute limits are
// retried inside the LLM adapter and never reach here (docs/conflicts.md C50).
export class QuotaExhaustedError extends DomainError {
  readonly code = "QUOTA_EXHAUSTED";

  constructor(
    readonly model: string,
    readonly retryAfterMs?: number,
  ) {
    super(
      `LLM daily quota exhausted for model "${model}". Switch LLM_PROVIDER=fallback in service/.env ` +
        "or wait for the provider's reset (docs/setup.md).",
    );
  }
}

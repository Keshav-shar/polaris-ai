import { DomainError } from "./domain-error";

// Which daily ceiling ran out. Groq has both, and they are not alike: 1,000 requests/day is rarely reached,
// while 200,000 TOKENS/day per model is what actually ends a writer pool's day (measured 2026-10-07, C119).
export type DailyLimit = "tokens" | "requests";

// The provider's DAILY quota is gone: no backoff inside this process can outlast it. Per-minute limits are
// retried inside the LLM adapter and never reach here (docs/conflicts.md C50).
export class QuotaExhaustedError extends DomainError {
  readonly code = "QUOTA_EXHAUSTED";

  constructor(
    readonly model: string,
    readonly retryAfterMs?: number,
    // undefined when the provider's wording named neither; the run's haltReason says so when it is known.
    readonly limit?: DailyLimit,
  ) {
    super(
      `LLM daily quota exhausted for model "${model}"${limit === undefined ? "" : ` (${limit} per day)`}. ` +
        "Add another vetted console model to LLM_MODELS in service/.env (docs/models.md) or wait for the " +
        "provider's reset.",
    );
  }
}

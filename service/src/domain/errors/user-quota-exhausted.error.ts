import { DomainError } from "./domain-error";

// The caller has started MAX_RUNS_PER_USER_PER_DAY builds today (UTC). A per-user cost guard, refused before any
// work (C105). HTTP 429 `user_quota_exhausted` with Retry-After = seconds until the next UTC day.
export class UserQuotaExhaustedError extends DomainError {
  readonly code = "USER_QUOTA_EXHAUSTED";

  constructor(
    readonly limit: number,
    readonly retryAfterMs: number,
  ) {
    super(`You have started ${limit} learning maps today, which is the daily limit. It resets at midnight UTC.`);
  }
}

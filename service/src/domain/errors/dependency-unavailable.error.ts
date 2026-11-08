import { DomainError } from "./domain-error";

// A service Polaris depends on - the database or the sign-in key set - could not be reached: the request never
// completed, so nothing was written, read or verified. Its own error so the API answers 503 + Retry-After rather
// than 500 (or a 401 for a token that may be perfectly good), and so the message sent to the client is ours:
// `detail` is an SDK string and stays in the log.
export class DependencyUnavailableError extends DomainError {
  readonly code = "DEPENDENCY_UNAVAILABLE";

  constructor(
    readonly dependency: "database" | "sign-in",
    readonly operation: string,
    readonly detail: string,
  ) {
    super(`The ${dependency} service could not be reached (${operation}).`);
  }
}

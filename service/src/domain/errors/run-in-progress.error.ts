import { DomainError } from "./domain-error";

// Another run is still `constructing` and the process will not start a second one. A cost guard, not a
// failure: every node is an LLM call, so N concurrent runs draw N times the quota (docs/conflicts.md C61).
// Mapped to 429 with `Retry-After` by interfaces/http/middleware.
export class RunInProgressError extends DomainError {
  readonly code = "RUN_IN_PROGRESS";

  constructor(
    readonly active: number,
    readonly limit: number,
  ) {
    super(
      `${active} run${active === 1 ? " is" : "s are"} already building (limit ${limit}). ` +
        "Wait for it to finish, or raise MAX_CONCURRENT_RUNS in service/.env (see docs/setup.md).",
    );
  }
}

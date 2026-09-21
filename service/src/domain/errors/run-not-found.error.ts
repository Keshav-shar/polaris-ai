import { DomainError } from "./domain-error";

// Mapped to 404 by interfaces/http/middleware in Phase 7.
export class RunNotFoundError extends DomainError {
  readonly code = "RUN_NOT_FOUND";

  constructor(readonly runId: string) {
    super(`Run ${runId} was not found.`);
  }
}

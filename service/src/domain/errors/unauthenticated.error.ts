import { DomainError } from "./domain-error";

// The request needs a signed-in user and has none, or its access token failed verification (expired, wrong
// issuer, bad signature). HTTP 401 `unauthenticated`. Thrown BEFORE any work, so a refusal costs nothing (C105).
export class UnauthenticatedError extends DomainError {
  readonly code = "UNAUTHENTICATED";

  constructor(message = "Sign in to do this.") {
    super(message);
  }
}

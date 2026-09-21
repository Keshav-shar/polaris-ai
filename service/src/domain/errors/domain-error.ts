// Base for expected failures. Callers branch on `code`; HTTP mapping lives in interfaces/http/middleware.
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

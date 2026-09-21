import { DomainError } from "./domain-error";

// LLM output still failed schema validation after every repair attempt.
export class StructuredOutputError extends DomainError {
  readonly code = "STRUCTURED_OUTPUT_INVALID";

  constructor(
    readonly label: string,
    readonly lastError: string,
  ) {
    super(`${label}: LLM output invalid after repair attempts: ${lastError}`);
  }
}

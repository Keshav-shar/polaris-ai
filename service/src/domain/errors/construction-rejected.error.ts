import { DomainError } from "./domain-error";

// The expansion is unusable; the message fails so the queue redelivers it (up to QUEUE.MAX_RECEIVES).
export class ConstructionRejectedError extends DomainError {
  readonly code = "CONSTRUCTION_REJECTED";

  constructor(readonly reason: string) {
    super(`Expansion rejected: ${reason}`);
  }
}

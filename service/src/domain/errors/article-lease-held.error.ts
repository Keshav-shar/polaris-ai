import { DomainError } from "./domain-error";

// Another delivery of the same article holds its claim (A18, C142). On SQS a boost is a SECOND copy of the message,
// so two deliveries can race; the loser must neither call the writer nor count a failed attempt. Handled as a stall:
// re-sent with a delay, uncounted, and by then the winner has usually finished, so the copy is a no-op.
export class ArticleLeaseHeldError extends DomainError {
  readonly code = "ARTICLE_LEASE_HELD";
  constructor(
    readonly nodeId: string,
    readonly retryAfterMs: number,
  ) {
    super(`The article for node "${nodeId}" is being written by another delivery.`);
  }
}

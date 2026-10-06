import { DomainError } from "./domain-error";

// A node id that is not in the tree. Distinct from RunNotFoundError so the HTTP layer can say WHICH thing
// was missing, and mapped to 404 in the one place that maps statuses.
export class NodeNotFoundError extends DomainError {
  readonly code = "NODE_NOT_FOUND";
  constructor(readonly nodeId: string) {
    super(`No node with id "${nodeId}".`);
  }
}

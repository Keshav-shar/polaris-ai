import { DomainError } from "./domain-error";

// A quiz attempt on a node that has no questions: not written yet, or a node with no credible source, which
// legitimately gets an article and no quiz (C80). Mapped to 404 `quiz_not_found`.
export class QuizNotFoundError extends DomainError {
  readonly code = "QUIZ_NOT_FOUND";
  constructor(readonly nodeId: string) {
    super("This lesson has no questions to answer yet.");
  }
}

import { UnauthenticatedError } from "../../domain/errors/unauthenticated.error";
import type { Caller } from "../../domain/schemas/caller.schema";
import type { LessonFeedback, LessonFeedbackBody } from "../../domain/schemas/feedback.schema";
import type { FeedbackPort } from "../ports/feedback.port";
import type { RunRepositoryPort } from "../ports/run-repository.port";
import type { TreeRepositoryPort } from "../ports/tree-repository.port";
import { readableNode } from "../tree/readable-node";

export type SetLessonFeedback = {
  execute(nodeId: string, feedback: LessonFeedbackBody, caller: Caller | undefined): Promise<LessonFeedback>;
};

// PUT /api/nodes/:nodeId/feedback (C138). Tags only - the body schema refuses anything else - and it costs no LLM
// call: the feedback is read later, in bulk, by the insight job.
export function createSetLessonFeedback(deps: {
  treeRepo: TreeRepositoryPort;
  runRepo: RunRepositoryPort;
  feedback: FeedbackPort;
}): SetLessonFeedback {
  return {
    async execute(nodeId, feedback, caller) {
      if (caller === undefined) throw new UnauthenticatedError("Sign in to rate a lesson.");
      const { node } = await readableNode(deps, nodeId, caller);
      return deps.feedback.upsert({ userId: caller.userId, nodeId, runId: node.runId }, feedback);
    },
  };
}

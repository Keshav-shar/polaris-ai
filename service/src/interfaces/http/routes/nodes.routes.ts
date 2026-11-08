import { Router } from "express";
import type { BoostArticle } from "../../../application/use-cases/boost-article.use-case";
import type { GetNode } from "../../../application/use-cases/get-node.use-case";
import type { RecordProgress } from "../../../application/use-cases/record-progress.use-case";
import type { SetLessonFeedback } from "../../../application/use-cases/set-lesson-feedback.use-case";
import type { SubmitQuizAttempt } from "../../../application/use-cases/submit-quiz-attempt.use-case";
import { NodeIdParams } from "../../../domain/schemas/api.schema";
import { LessonFeedbackBody } from "../../../domain/schemas/feedback.schema";
import { ProgressBody, QuizAttemptBody } from "../../../domain/schemas/progress.schema";
import { readCaller } from "../middleware/auth.middleware";
import { validateBody, validateParams } from "../middleware/validate.middleware";

export type NodesRoutesDeps = {
  getNode(): GetNode;
  boostArticle(): BoostArticle;
  submitQuizAttempt(): SubmitQuizAttempt;
  recordProgress(): RecordProgress;
  setLessonFeedback(): SetLessonFeedback;
};

// Mounted at /api/nodes. One call gives the reader the node, its article and its questions.
export function createNodesRouter({
  getNode,
  boostArticle,
  submitQuizAttempt,
  recordProgress,
  setLessonFeedback,
}: NodesRoutesDeps): Router {
  const params = validateParams(NodeIdParams);
  const attempt = validateBody(QuizAttemptBody);
  const read = validateBody(ProgressBody);
  const feedback = validateBody(LessonFeedbackBody);
  const router = Router();

  // Auth: none for a node of a non-private run; the run's owner for a private one (404 to anyone else).
  router.get("/:nodeId", params.middleware, async (_req, res) => {
    res.json(await getNode().execute(params.read(res).nodeId, readCaller(res)));
  });

  // 202: the scroll is not written by this request, only moved up the queue. No body, no LLM call (C128).
  // Auth: whoever may read the run (C105); rate limit: the Phase 11S per-IP bucket. Cost if abused: reordering
  // only - at most one queued message moved per call, never a new one.
  router.post("/:nodeId/boost", params.middleware, async (_req, res) => {
    res.status(202).json(await boostArticle().execute(params.read(res).nodeId, readCaller(res)));
  });

  // Scored on the server (C106). Auth: whoever may read the node; stored only for a signed-in caller. Rate limit:
  // the Phase 11S per-IP bucket. Cost: one quiz read + one upsert, no LLM call.
  router.post("/:nodeId/quiz-attempts", params.middleware, attempt.middleware, async (_req, res) => {
    res.json(
      await submitQuizAttempt().execute(params.read(res).nodeId, attempt.read(res).answers, readCaller(res)),
    );
  });

  // Auth: signed in (401 otherwise) and able to read the node. Rate limit: Phase 11S. Cost: one upsert.
  router.put("/:nodeId/progress", params.middleware, read.middleware, async (_req, res) => {
    res.json(await recordProgress().markRead(params.read(res).nodeId, readCaller(res)));
  });

  // Tags only (C138): the body is a strict schema, so free text is refused with 400 rather than dropped. Auth:
  // signed in and able to read the node. Rate limit: Phase 11S. Cost: one upsert, no LLM call.
  router.put("/:nodeId/feedback", params.middleware, feedback.middleware, async (_req, res) => {
    res.json(await setLessonFeedback().execute(params.read(res).nodeId, feedback.read(res), readCaller(res)));
  });

  return router;
}

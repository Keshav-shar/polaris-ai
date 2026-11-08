import { publicQuiz } from "../../domain/entities/quiz-scoring";
import type { NodeResponse } from "../../domain/schemas/api.schema";
import type { Caller } from "../../domain/schemas/caller.schema";
import type { ArticleRepositoryPort } from "../ports/article-repository.port";
import type { FeedbackPort } from "../ports/feedback.port";
import type { ProgressPort } from "../ports/progress.port";
import type { QuizStorePort } from "../ports/quiz-store.port";
import type { RunRepositoryPort } from "../ports/run-repository.port";
import type { TreeRepositoryPort } from "../ports/tree-repository.port";
import type { Logger } from "../../shared/logger";
import { optionalRead } from "../tree/optional-read";
import { readableNode } from "../tree/readable-node";

export type GetNode = {
  // A node of a private run that is not the caller's answers 404, exactly like an unknown node (C105).
  execute(nodeId: string, caller?: Caller): Promise<NodeResponse>;
};

// Read model for GET /api/nodes/:nodeId. Answers from stored state only and never waits on either pass, so
// a node whose article has not been written yet returns `article: null` rather than hanging.
export function createGetNode({
  treeRepo,
  runRepo,
  articleRepo,
  quizStore,
  progress,
  feedback,
  logger,
}: {
  treeRepo: TreeRepositoryPort;
  runRepo: RunRepositoryPort;
  articleRepo: ArticleRepositoryPort;
  quizStore: QuizStorePort;
  // The caller's own state on the lesson (Phase C). Optional so a reader without per-user stores still works.
  progress?: ProgressPort | undefined;
  feedback?: FeedbackPort | undefined;
  // Where a failed per-user read is reported; the lesson is served without it either way (C143).
  logger?: Pick<Logger, "warn"> | undefined;
}): GetNode {
  return {
    async execute(nodeId, caller) {
      // Checked BEFORE the article and quiz are read, so a refused request reads nothing more.
      const { node } = await readableNode({ treeRepo, runRepo }, nodeId, caller);

      // The parent is fetched for its TOPIC only: the reader links upward by name, and pulling the whole
      // parent record would double the payload for one string.
      const [parent, article, quiz, mine, rated] = await Promise.all([
        node.parentId === null ? Promise.resolve(undefined) : treeRepo.getNode(node.parentId),
        articleRepo.get(nodeId),
        quizStore.get(nodeId),
        // The caller's OWN extras: optional, so a missing table or a blip costs the markers, never the lesson (C143).
        caller === undefined ? undefined : optionalRead(progress?.get(caller.userId, nodeId), logger, "progress.get"),
        caller === undefined ? undefined : optionalRead(feedback?.get(caller.userId, nodeId), logger, "feedback.get"),
      ]);

      return {
        node: {
          id: node.nodeId,
          runId: node.runId,
          topic: node.topic,
          depth: node.depth,
          brief: node.brief,
          parent: parent === undefined ? null : { id: parent.nodeId, topic: parent.topic },
          children: node.children.map((child) => ({ id: child.nodeId, topic: child.topic })),
        },
        article: article ?? null,
        ...(node.articleFailureReason === undefined
          ? {}
          : { articleFailureReason: node.articleFailureReason }),
        // The answer key never leaves with the question (C106): it comes back only in an attempt's response.
        quiz: quiz === undefined ? null : publicQuiz(quiz),
        ...(mine === undefined ? {} : { progress: mine }),
        ...(rated === undefined ? {} : { feedback: rated }),
      };
    },
  };
}

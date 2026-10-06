import { NodeNotFoundError } from "../../domain/errors/node-not-found.error";
import type { NodeResponse } from "../../domain/schemas/api.schema";
import type { ArticleRepositoryPort } from "../ports/article-repository.port";
import type { QuizStorePort } from "../ports/quiz-store.port";
import type { TreeRepositoryPort } from "../ports/tree-repository.port";

export type GetNode = {
  execute(nodeId: string): Promise<NodeResponse>;
};

// Read model for GET /api/nodes/:nodeId. Answers from stored state only and never waits on either pass, so
// a node whose article has not been written yet returns `article: null` rather than hanging.
export function createGetNode({
  treeRepo,
  articleRepo,
  quizStore,
}: {
  treeRepo: TreeRepositoryPort;
  articleRepo: ArticleRepositoryPort;
  quizStore: QuizStorePort;
}): GetNode {
  return {
    async execute(nodeId) {
      const node = await treeRepo.getNode(nodeId);
      if (node === undefined) throw new NodeNotFoundError(nodeId);

      // The parent is fetched for its TOPIC only: the reader links upward by name, and pulling the whole
      // parent record would double the payload for one string.
      const [parent, article, quiz] = await Promise.all([
        node.parentId === null ? Promise.resolve(undefined) : treeRepo.getNode(node.parentId),
        articleRepo.get(nodeId),
        quizStore.get(nodeId),
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
        quiz: quiz ?? null,
      };
    },
  };
}

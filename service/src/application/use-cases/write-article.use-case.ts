import { ArticleContext, type WriterOutput } from "../../domain/schemas/article.schema";
import type { NodeMessage } from "../../domain/schemas/queue-message.schema";
import { QuizOutput } from "../../domain/schemas/quiz.schema";
import type { Logger } from "../../shared/logger";
import type { GuardrailAgent } from "../agents/guardrail.agent";
import type { RetrievalAgent } from "../agents/retrieval.agent";
import type { WriterAgent } from "../agents/writer.agent";
import type { ArticleRepositoryPort } from "../ports/article-repository.port";
import type { NodeStatePort } from "../ports/node-state.port";
import type { QuizStorePort } from "../ports/quiz-store.port";
import type { TreeRepositoryPort } from "../ports/tree-repository.port";
import type { FanIn } from "../tree/fan-in";

export type WriteArticleDeps = {
  nodeState: NodeStatePort;
  treeRepo: TreeRepositoryPort;
  articleRepo: ArticleRepositoryPort;
  quizStore: QuizStorePort;
  retrieval: RetrievalAgent;
  guardrail: GuardrailAgent;
  writer: WriterAgent;
  fanIn: FanIn;
  logger: Pick<Logger, "warn">;
};

export type WriteArticle = {
  execute(message: NodeMessage): Promise<void>;
};

// One article message = one node's article and its questions. The second pass, and still a separate one -
// its own queue, its own worker, its own concurrency - but since C91 it runs CONCURRENTLY with
// construction: expand-node enqueues a node's article the moment that node's own expansion is stored, so
// this node's scroll is written while its children are being expanded. It is idempotent for the same
// reasons construction is: SQS delivers at-least-once and the local worker redelivers on failure.
//
// Like expand-node, this use-case NEVER catches: an error must reach the worker, or redelivery and the
// dead-letter path behind it are defeated.
export function createWriteArticle({
  nodeState,
  treeRepo,
  articleRepo,
  quizStore,
  retrieval,
  guardrail,
  writer,
  fanIn,
  logger,
}: WriteArticleDeps): WriteArticle {
  return {
    async execute(message) {
      const { runId, nodeId, topic, ancestors } = message;

      const claim = await nodeState.claimArticle(nodeId);
      // Rule 1: this node's article is already finished, so a duplicate delivery does nothing.
      if (claim.articleStatus === "done" || claim.articleStatus === "failed") return;

      // From the PERMANENT store, not from the claim: node state expires, and only the tree rows carry
      // this node's children, which is what the article signposts.
      const node = await treeRepo.getNode(nodeId);
      if (node === undefined) throw new Error(`write-article: node ${nodeId} is not in the tree`);

      // The nearest ancestor IS the parent, and it already carries the parent's brief - that is what the
      // construct message's ancestor window is for, so the parent is never re-read.
      const parentRef = ancestors.at(-1);
      // EVERY child row, whatever its status: at this moment the children have only just been created as
      // `pending` and none of them is `done` yet, so filtering on status would empty the list and budget
      // every node in the tree as a leaf. They are the node's own plan for what sits below it (C91).
      const children = node.children;

      let article: WriterOutput | undefined = claim.article;
      if (article === undefined) {
        // Rule 2 has not been satisfied yet, so this is the one path that spends an LLM call.
        const { items } = await retrieval.retrieve({
          topic,
          parentTopic: parentRef?.topic ?? null,
        });
        const assessment = guardrail.checkCredibility(items);
        const context = ArticleContext.parse({
          node: { id: node.nodeId, topic: node.topic, depth: node.depth, brief: node.brief },
          parent: parentRef === undefined ? null : { topic: parentRef.topic, brief: parentRef.brief },
          // Signpost material: the child's TOPIC and nothing else (C86, amended by C91 - a child's brief
          // does not exist yet when this runs). Naming a subtopic is enough to hand the detail downward.
          children: children.map((child) => ({ topic: child.topic })),
          // Leaf means "nothing below to hand specifics to", which is what decides both the scope and the
          // word band.
          isLeaf: children.length === 0,
          // Only the credible subset reaches the writer, so an unverified article is one written from thin
          // evidence rather than from bad evidence.
          evidence: assessment.credible,
        });
        const drafted = await writer.write(context);
        if (!assessment.verified) {
          logger.warn("article written on thin evidence", {
            nodeId,
            topic,
            credibleCount: assessment.credibleCount,
            note: "stored with credibilityVerified: false; not dropped",
          });
        }
        // Rule 2: stored before any side effect, and the STORED value is what we go on to use, so a
        // concurrent delivery that got there first wins and both agree on the article.
        const saved = await nodeState.saveArticle(nodeId, drafted);
        article = saved.article;
        if (article === undefined) throw new Error(`saveArticle left node ${nodeId} without an article`);
      }

      // Rule 6: upserts keyed on nodeId, so a redelivery rewrites the same rows.
      await articleRepo.upsert({
        nodeId,
        contentMd: article.contentMd,
        citations: article.citations,
        // Verified means the gate passed AND the writer actually cited something.
        credibilityVerified: article.citations.length > 0,
      });
      // Stored separately from the article, matching the planned `articles` / `quizzes` tables. Absent
      // questions is a legitimate state, not a failure: a node with no credible source cannot have any.
      if (article.questions !== undefined) {
        const quiz = QuizOutput.safeParse({ questions: article.questions });
        if (quiz.success) await quizStore.upsert({ nodeId, questions: quiz.data.questions });
        else logger.warn("questions dropped: wrong shape for QUIZ_CONFIG", { nodeId, topic });
      }

      await fanIn.completeArticle(runId, nodeId, "done");
    },
  };
}

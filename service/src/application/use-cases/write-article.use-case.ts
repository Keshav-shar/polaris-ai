import { type ArticleDraft, ArticleContext } from "../../domain/schemas/article.schema";
import type { NodeMessage } from "../../domain/schemas/queue-message.schema";
import { QuizOutput } from "../../domain/schemas/quiz.schema";
import type { Logger } from "../../shared/logger";
import type { GuardrailAgent } from "../agents/guardrail.agent";
import type { RetrievalAgent } from "../agents/retrieval.agent";
import type { WriterAgent } from "../agents/writer.agent";
import type { ArticleRepositoryPort } from "../ports/article-repository.port";
import type { EvidenceRepositoryPort } from "../ports/evidence-repository.port";
import type { NodeStatePort } from "../ports/node-state.port";
import type { QuizStorePort } from "../ports/quiz-store.port";
import type { TreeRepositoryPort } from "../ports/tree-repository.port";
import type { FanIn } from "../tree/fan-in";

export type WriteArticleDeps = {
  nodeState: NodeStatePort;
  treeRepo: TreeRepositoryPort;
  articleRepo: ArticleRepositoryPort;
  quizStore: QuizStorePort;
  // Every source the writer was shown, with the query that found it (C79, C123).
  evidenceRepo: EvidenceRepositoryPort;
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
  evidenceRepo,
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
      // every node in the tree as a leaf. They are the node's own plan for what sits below it (C91), each
      // with the brief this node's own expansion wrote for it (C99).
      const children = node.children;

      let article: ArticleDraft | undefined = claim.article;
      if (article === undefined) {
        // Rule 2 has not been satisfied yet, so this is the one path that spends an LLM call.
        const { items, query, retrievedAt } = await retrieval.retrieve({
          topic,
          parentTopic: parentRef?.topic ?? null,
        });
        // Provenance first, before the writer runs: a draft is only explainable if what it was shown is on
        // record. A redelivery that searches again replaces the set rather than adding to it (C123).
        await evidenceRepo.replaceForNode(
          nodeId,
          items.map((item) => ({ ...item, nodeId, retrievalQuery: query, retrievedAt })),
        );
        const assessment = guardrail.checkCredibility(items);
        const context = ArticleContext.parse({
          node: { id: node.nodeId, topic: node.topic, depth: node.depth, brief: node.brief },
          parent: parentRef === undefined ? null : { topic: parentRef.topic, brief: parentRef.brief },
          // Signpost material: each child's topic and the brief its parent wrote for it (C86, restored by
          // C102 - since C99 the parent writes those briefs, so they exist before this node's article
          // message is even sent). Enough to say in a clause what a subtopic covers, never to teach it.
          children: children.map((child) => ({ topic: child.topic, brief: child.brief })),
          // Leaf means "nothing below to hand specifics to", which is what decides both the scope and the
          // word band.
          isLeaf: children.length === 0,
          // Only the credible subset reaches the writer, so an unverified article is one written from thin
          // evidence rather than from bad evidence.
          evidence: assessment.credible,
        });
        // The writer's draft passes the article guard before it is stored: a citation whose claim its source
        // does not support is dropped (C124), a quiz with a sanity problem is dropped (C125). The article
        // text is never touched.
        // A boosted message's call also jumps the LLM queue, not only the article queue (C128, C129).
        const written = await writer.write(context, { boosted: message.boost === true });
        const { draft: drafted, report } = guardrail.guardArticle(written, assessment.credible);
        if (report.groundedness.ungrounded > 0) {
          logger.warn("citations dropped: not supported by their source", {
            nodeId,
            topic,
            dropped: report.groundedness.ungrounded,
            grounded: report.groundedness.grounded,
            unjudged: report.groundedness.unjudged,
          });
        }
        if (report.quizProblems.length > 0) {
          logger.warn("questions dropped: failed the quiz sanity check", { nodeId, topic, problems: report.quizProblems });
        }
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
        // The verdict is computed HERE, from this attempt's own gate, and stored with the draft: a redelivery
        // reuses the draft without searching again, so it could not recompute it (C118).
        // Verified = the gate passed AND at least one citation survived the groundedness check (C118, C124):
        // an unjudged or dropped citation is not evidence that the article is sourced.
        const credibilityVerified = assessment.verified && report.groundedness.grounded > 0;
        const saved = await nodeState.saveArticle(nodeId, { ...drafted, credibilityVerified });
        article = saved.article;
        if (article === undefined) throw new Error(`saveArticle left node ${nodeId} without an article`);
      }

      // Rule 6: upserts keyed on nodeId, so a redelivery rewrites the same rows.
      await articleRepo.upsert({
        nodeId,
        contentMd: article.contentMd,
        citations: article.citations,
        // The gate's verdict, stored with the draft - not "cited something", which called an article
        // verified even when the gate had failed (C118).
        credibilityVerified: article.credibilityVerified,
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

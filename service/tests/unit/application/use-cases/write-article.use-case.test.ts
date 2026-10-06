import { describe, expect, it } from "vitest";
import type { GuardrailAgent } from "../../../../src/application/agents/guardrail.agent";
import { createGuardrailAgent } from "../../../../src/application/agents/guardrail.agent";
import type { RetrievalAgent } from "../../../../src/application/agents/retrieval.agent";
import type { WriterAgent } from "../../../../src/application/agents/writer.agent";
import { rootConstructMessage } from "../../../../src/application/tree/messages";
import { createWriteArticle } from "../../../../src/application/use-cases/write-article.use-case";
import { QUIZ_CONFIG } from "../../../../src/config/constants";
import type { ArticleContext, WriterOutput } from "../../../../src/domain/schemas/article.schema";
import type { EvidenceItem } from "../../../../src/domain/schemas/evidence.schema";
import { createMemoryArticleRepository } from "../../../../src/infrastructure/memory/memory-article.repository";
import { createMemoryQuizStore } from "../../../../src/infrastructure/memory/memory-quiz.store";
import { buildHarness } from "../../../fixtures/build-harness";

const runId = "11111111-1111-4111-8111-111111111111";
// maxDepth 1: the root's children are leaves, so construction finishes in one pass over the queue.
const root = rootConstructMessage(runId, { topic: "photosynthesis", maxDepth: 1 });

const SOURCE_URL = "https://en.wikipedia.org/w/index.php?curid=1";

function source(url = SOURCE_URL, credibility = 0.9): EvidenceItem {
  return { url, title: "A source", snippet: "a quoted snippet", credibility };
}

function questions(url = SOURCE_URL) {
  return Array.from({ length: QUIZ_CONFIG.QUESTIONS_PER_TOPIC }, (_, i) => ({
    question: `q${i}?`,
    options: ["a", "b", "c", "d"],
    answerIndex: 0,
    explanation: "because",
    evidenceUrl: url,
  }));
}

function fakes(options: { evidence?: EvidenceItem[]; output?: Partial<WriterOutput> } = {}) {
  const evidence = options.evidence ?? [source(), source("https://www.nih.gov/x")];
  const contexts: ArticleContext[] = [];
  let writerCalls = 0;
  let retrievalCalls = 0;

  const retrieval: RetrievalAgent = {
    async retrieve() {
      retrievalCalls += 1;
      return { query: "q", retrievedAt: "2026-09-22T00:00:00.000Z", items: evidence };
    },
  };
  const writer: WriterAgent = {
    async write(context) {
      writerCalls += 1;
      contexts.push(context);
      return {
        contentMd: "A short article.",
        citations: [{ url: SOURCE_URL, claim: "a claim" }],
        questions: questions(),
        ...options.output,
      };
    },
  };
  const guardrail: GuardrailAgent = createGuardrailAgent();
  return {
    retrieval,
    writer,
    guardrail,
    contexts,
    get writerCalls() {
      return writerCalls;
    },
    get retrievalCalls() {
      return retrievalCalls;
    },
  };
}

// Builds a finished depth-1 tree, then returns everything needed to run the article pass over it.
async function constructed(harnessOptions: Parameters<typeof buildHarness>[0] = { breadth: 2 }) {
  const h = buildHarness(harnessOptions);
  await h.runRepo.create({ runId, topic: "photosynthesis", maxDepth: 1, status: "constructing" });
  await h.expandNode.execute(root);
  for (const receipt of await h.queue.receive(10)) await h.expandNode.execute(receipt.message);
  return h;
}

function writeArticleFor(h: Awaited<ReturnType<typeof constructed>>, f: ReturnType<typeof fakes>) {
  const articleRepo = createMemoryArticleRepository();
  const quizStore = createMemoryQuizStore();
  const useCase = createWriteArticle({
    nodeState: h.nodeState,
    treeRepo: h.treeRepo,
    articleRepo,
    quizStore,
    retrieval: f.retrieval,
    guardrail: f.guardrail,
    writer: f.writer,
    fanIn: h.fanIn,
    logger: { warn: () => {} },
  });
  return { useCase, articleRepo, quizStore };
}

describe("write-article use-case", () => {
  it("stores the article and its questions as two records from one writer call", async () => {
    const h = await constructed();
    const f = fakes();
    const { useCase, articleRepo, quizStore } = writeArticleFor(h, f);
    const [message] = await h.articleQueue.receive(1);

    await useCase.execute(message!.message);

    expect(f.writerCalls).toBe(1);
    const article = await articleRepo.get(root.nodeId);
    expect(article).toMatchObject({ nodeId: root.nodeId, contentMd: "A short article." });
    const quiz = await quizStore.get(root.nodeId);
    expect(quiz?.questions).toHaveLength(QUIZ_CONFIG.QUESTIONS_PER_TOPIC);
  });

  it("names the node's children so the article can signpost them", async () => {
    // The invariant changed twice: C86 made children present as topic + brief, C91 cut it back to the
    // TOPIC, because the article is now written while those children are still being expanded.
    const h = await constructed();
    const f = fakes();
    const { useCase } = writeArticleFor(h, f);
    const [message] = await h.articleQueue.receive(1);
    await useCase.execute(message!.message);

    const tree = await h.treeRepo.getTree(runId);
    const expected = (tree?.children ?? []).map((c) => c.topic).sort();
    const seen = (f.contexts[0]?.children ?? []).map((c) => c.topic).sort();
    expect(seen).toEqual(expected);
    expect(f.contexts[0]?.isLeaf).toBe(false);
  });

  it("gives the writer nothing about a child beyond its topic", async () => {
    // The guard that keeps the relaxation honest. A child's brief, its own article and its own children
    // must stay invisible, or "one node, one slice" collapses and articles start repeating each other.
    const h = await constructed();
    const f = fakes();
    const { useCase } = writeArticleFor(h, f);
    const [message] = await h.articleQueue.receive(1);
    await useCase.execute(message!.message);

    for (const child of f.contexts[0]?.children ?? []) {
      expect(Object.keys(child)).toEqual(["topic"]);
    }
  });

  it("budgets an interior node by its child count, not as a leaf", async () => {
    // The trap C91 has to avoid: the children are all still `pending` when this runs, so a status filter
    // would hand the writer an empty list and every node in the tree would be written as a leaf.
    const h = await constructed();
    const f = fakes();
    const { useCase } = writeArticleFor(h, f);
    const [message] = await h.articleQueue.receive(1);
    await useCase.execute(message!.message);

    expect(f.contexts[0]?.children).toHaveLength(2);
    expect(f.contexts[0]?.isLeaf).toBe(false);
  });

  it("keeps grandchildren out of the writer's context entirely", async () => {
    // Depth-2 run, so the root's children have children of their own. The root's article must not be able
    // to see them - that is what stops it teaching two layers at once.
    const h = buildHarness({ breadth: 2 });
    await h.runRepo.create({ runId, topic: "photosynthesis", maxDepth: 2, status: "constructing" });
    const deepRoot = rootConstructMessage(runId, { topic: "photosynthesis", maxDepth: 2 });
    await h.expandNode.execute(deepRoot);
    for (let i = 0; i < 4; i++) {
      const batch = await h.queue.receive(10);
      if (batch.length === 0) break;
      for (const receipt of batch) await h.expandNode.execute(receipt.message);
    }
    const f = fakes();
    const { useCase } = writeArticleFor(h, f);
    const [rootArticle] = await h.articleQueue.receive(1);
    await useCase.execute(rootArticle!.message);

    const tree = await h.treeRepo.getTree(runId);
    const grandchildTopics = (tree?.children ?? []).flatMap((c) => c.children.map((g) => g.topic));
    expect(grandchildTopics.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(f.contexts[0]);
    for (const topic of grandchildTopics) {
      expect(serialized).not.toContain(topic);
    }
  });

  it("is a no-op on redelivery of a finished article (rule 1)", async () => {
    const h = await constructed();
    const f = fakes();
    const { useCase } = writeArticleFor(h, f);
    const [message] = await h.articleQueue.receive(1);

    await useCase.execute(message!.message);
    await useCase.execute(message!.message);

    expect(f.writerCalls).toBe(1);
  });

  it("reuses the stored draft instead of calling the LLM again (rule 2)", async () => {
    // THE test that NodeState.article exists for: without the stored draft a redelivery that got past the
    // claim would pay for a whole second generation. Reaching this path needs the article stored but the
    // status not yet terminal, which is exactly what a crash between saveArticle and completeArticle does.
    const h = await constructed();
    const f = fakes();
    const { useCase, articleRepo } = writeArticleFor(h, f);
    const [message] = await h.articleQueue.receive(1);

    await useCase.execute(message!.message);
    // Rewind only the terminal flag, leaving the stored draft in place.
    const claimed = await h.nodeState.claimArticle(root.nodeId);
    expect(claimed.article).toBeDefined();
    await useCase.execute(message!.message);

    expect(f.writerCalls).toBe(1);
    expect(f.retrievalCalls).toBe(1);
    expect((await articleRepo.get(root.nodeId))?.contentMd).toBe("A short article.");
  });

  it("enqueues nothing itself: the children's articles came from construction (C91)", async () => {
    const h = await constructed();
    const f = fakes();
    const { useCase } = writeArticleFor(h, f);
    const [rootMessage] = await h.articleQueue.receive(1);
    const queuedBefore = h.articleQueue.size();

    await useCase.execute(rootMessage!.message);

    // The pass is no longer handed down article-by-article, so writing one adds no message at all.
    // size() counts visible + in-flight, and deleting the handled message is the worker's job, so an
    // unchanged size here means exactly "nothing was enqueued".
    expect(h.articleQueue.size()).toBe(queuedBefore);
    const children = await h.articleQueue.receive(10);
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(child.message.pass).toBe("article");
      expect(child.message.parentId).toBe(root.nodeId);
      // The documented parent-context payload is the parent's brief, never its article.
      const parentRef = child.message.ancestors.at(-1);
      expect(parentRef?.brief).not.toBe("A short article.");
    }
  });

  it("gives every article message the id construction minted (rule 4)", async () => {
    const h = await constructed();

    const tree = await h.treeRepo.getTree(runId);
    const constructedIds = [tree?.id, ...(tree?.children ?? []).map((c) => c.id)].sort();
    const articleIds = (await h.articleQueue.receive(10)).map((r) => r.message.nodeId).sort();
    expect(articleIds).toEqual(constructedIds);
  });

  it("counts the article so the run reaches done once every article is in", async () => {
    const h = await constructed();
    const f = fakes();
    const { useCase } = writeArticleFor(h, f);

    for (let i = 0; i < 10; i++) {
      const batch = await h.articleQueue.receive(10);
      if (batch.length === 0) break;
      for (const receipt of batch) await useCase.execute(receipt.message);
    }

    expect((await h.runRepo.get(runId))?.status).toBe("done");
    const state = await h.runState.get(runId);
    expect(state?.articlesDone).toBe(state?.nodesDone);
  });

  it("stores an unverified article and NO quiz when no source is credible (C80)", async () => {
    // Every question must cite an evidence url, so questions are unsatisfiable without evidence. The node
    // still gets its article - it is never dropped.
    const h = await constructed();
    const f = fakes({
      evidence: [source("https://reddit.com/r/x", 0.25)],
      output: { citations: [], questions: undefined },
    });
    const { useCase, articleRepo, quizStore } = writeArticleFor(h, f);
    const [message] = await h.articleQueue.receive(1);

    await useCase.execute(message!.message);

    expect(await articleRepo.get(root.nodeId)).toMatchObject({ credibilityVerified: false });
    expect(await quizStore.get(root.nodeId)).toBeUndefined();
  });

  it("hands the writer only the credible subset of the evidence", async () => {
    const h = await constructed();
    const f = fakes({ evidence: [source(), source("https://reddit.com/weak", 0.25)] });
    const { useCase } = writeArticleFor(h, f);
    const [message] = await h.articleQueue.receive(1);
    await useCase.execute(message!.message);

    expect(f.contexts[0]?.evidence.map((e) => e.url)).toEqual([SOURCE_URL]);
  });

  it("throws when the node is not in the tree, rather than writing an orphan article", async () => {
    const h = await constructed();
    const f = fakes();
    const { useCase } = writeArticleFor(h, f);
    const [message] = await h.articleQueue.receive(1);
    const orphan = { ...message!.message, nodeId: "22222222-2222-4222-8222-222222222222" };

    await expect(useCase.execute(orphan)).rejects.toThrow();
  });
});

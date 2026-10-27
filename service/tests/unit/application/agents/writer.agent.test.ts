import { describe, expect, it } from "vitest";
import { createWriterAgent } from "../../../../src/application/agents/writer.agent";
import type { ArticleContext, WriterOutput } from "../../../../src/domain/schemas/article.schema";
import { fakeGenerate } from "../../../fixtures/fake-generate";

const known = "https://en.wikipedia.org/w/index.php?curid=1";
const invented = "https://example.com/made-up";

const context: ArticleContext = {
  node: { id: "00000000-0000-4000-8000-000000000001", topic: "Paging", depth: 1, brief: "Pages and frames." },
  parent: { topic: "Memory management", brief: "How memory is handed out." },
  isLeaf: true,
  children: [],
  evidence: [{ url: known, title: "Paging", snippet: "Paging divides memory.", credibility: 0.9 }],
};

const question = (evidenceUrl: string) => ({
  question: "What does paging divide memory into?",
  options: ["Pages", "Segments", "Heaps", "Stacks"],
  answerIndex: 0,
  explanation: "Paging uses fixed-size pages.",
  evidenceUrl,
});

async function write(reply: WriterOutput): Promise<WriterOutput> {
  const { generate } = fakeGenerate(async () => reply);
  return createWriterAgent({ generate }).write(context);
}

describe("createWriterAgent", () => {
  it("keeps citations and a full question set that cite only the node's sources", async () => {
    const out = await write({
      contentMd: "Paging divides memory.",
      citations: [{ url: known, claim: "Paging divides memory." }],
      questions: [question(known), question(known), question(known)],
    });
    expect(out.citations).toHaveLength(1);
    expect(out.questions).toHaveLength(3);
  });

  it("drops a citation to a url the node was not given", async () => {
    const out = await write({
      contentMd: "Paging divides memory.",
      citations: [
        { url: known, claim: "Paging divides memory." },
        { url: invented, claim: "Something unsupported." },
      ],
    });
    expect(out.citations.map((c) => c.url)).toEqual([known]);
  });

  // Regression (C117): the set used to be "dropped" by NOT re-adding it after `...output` had already copied
  // the unfiltered one in - so a question citing an invented source survived, and with it a quiz whose
  // "evidence" link points at a page the node never had.
  it("drops the WHOLE question set when any question cites an unknown url", async () => {
    const out = await write({
      contentMd: "Paging divides memory.",
      citations: [{ url: known, claim: "Paging divides memory." }],
      questions: [question(known), question(known), question(invented)],
    });
    expect(out.questions).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain(invented);
  });

  // With strict structured output `questions` is always present (C114); `[]` means "nothing to ask".
  it("treats an empty question list as no quiz", async () => {
    const out = await write({ contentMd: "Paging divides memory.", citations: [], questions: [] });
    expect(out.questions).toBeUndefined();
  });
});

describe("createWriterAgent, scheduling (C129)", () => {
  const reply: WriterOutput = { contentMd: "Paging divides memory.", citations: [] };

  it("asks for the article lane at the node's depth", async () => {
    const { generate, requests } = fakeGenerate(async () => reply);
    await createWriterAgent({ generate }).write(context);
    expect(requests[0]?.priority).toEqual({ lane: "article", depth: 1 });
  });

  it("asks for the boosted lane when a learner boosted the node", async () => {
    const { generate, requests } = fakeGenerate(async () => reply);
    await createWriterAgent({ generate }).write(context, { boosted: true });
    expect(requests[0]?.priority).toEqual({ lane: "boosted-article", depth: 1 });
  });
});

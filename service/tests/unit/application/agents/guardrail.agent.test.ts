import { describe, expect, it } from "vitest";
import {
  assessCredibility,
  assessGroundedness,
  checkCredibility,
  checkQuizSanity,
  createGuardrailAgent,
  guardArticle,
} from "../../../../src/application/agents/guardrail.agent";
import { CREDIBILITY, QUIZ_CONFIG } from "../../../../src/config/constants";
import type { EvidenceItem } from "../../../../src/domain/schemas/evidence.schema";

// REGRESSION SUITE. .claude/CLAUDE.md: "Any guardrail/verifier change needs a regression test." This gate
// decides whether an article is presented as verified, so every boundary below is deliberate.

function source(url: string, credibility: number): EvidenceItem {
  return { url, title: `Title for ${url}`, snippet: "snippet", credibility };
}

describe("assessCredibility", () => {
  it("passes on exactly MIN_CREDIBLE_SOURCES at exactly MIN_SCORE", () => {
    // The gate is >=, on both counts. An off-by-one here silently unverifies correct articles.
    const evidence = [
      source("https://a.example/1", CREDIBILITY.MIN_SCORE),
      source("https://b.example/2", CREDIBILITY.MIN_SCORE),
    ];
    const result = assessCredibility(evidence);
    expect(result.verified).toBe(true);
    expect(result.credibleCount).toBe(CREDIBILITY.MIN_CREDIBLE_SOURCES);
  });

  it("fails when one source is a hair below MIN_SCORE", () => {
    const evidence = [
      source("https://a.example/1", CREDIBILITY.MIN_SCORE),
      source("https://b.example/2", CREDIBILITY.MIN_SCORE - 0.01),
    ];
    const result = assessCredibility(evidence);
    expect(result.verified).toBe(false);
    expect(result.credibleCount).toBe(1);
  });

  it("fails on no evidence at all, without throwing", () => {
    const result = assessCredibility([]);
    expect(result.verified).toBe(false);
    expect(result.credibleCount).toBe(0);
    expect(result.credible).toEqual([]);
  });

  it("counts two pages of ONE site as two sources, because the default provider is Wikipedia-only", () => {
    // Deliberate: SEARCH_PROVIDER=wikipedia returns only wikipedia.org URLs, so a distinct-DOMAIN rule
    // would make this gate unreachable and mark every article unverified. Distinctness is per document.
    const evidence = [
      source("https://en.wikipedia.org/w/index.php?curid=1", 0.75),
      source("https://en.wikipedia.org/w/index.php?curid=2", 0.75),
    ];
    const result = assessCredibility(evidence);
    expect(result.verified).toBe(true);
    // ...but single-site evidence is still visible rather than hidden.
    expect(result.distinctDomains).toBe(1);
  });

  it("reports distinct domains when the evidence really is spread across sites", () => {
    const result = assessCredibility([
      source("https://en.wikipedia.org/w/index.php?curid=1", 0.75),
      source("https://www.nature.com/articles/a", 0.9),
    ]);
    expect(result.distinctDomains).toBe(2);
  });

  it("hands back only the sources that cleared the gate, best first", () => {
    const result = assessCredibility([
      source("https://weak.example/1", 0.2),
      source("https://ok.example/2", 0.7),
      source("https://best.example/3", 0.95),
    ]);
    expect(result.credible.map((e) => e.url)).toEqual(["https://best.example/3", "https://ok.example/2"]);
  });
});

describe("checkCredibility", () => {
  it("never throws and never drops the node when the gate fails", () => {
    // The documented rule: "A node that fails the gate still gets an article, marked unverified; it is not
    // dropped." A throw here would fail the node and, after 3 redeliveries, dead-letter it.
    const weak = [source("https://reddit.com/r/x", 0.25)];
    expect(() => checkCredibility(weak)).not.toThrow();
    expect(checkCredibility(weak).verified).toBe(false);
    expect(() => checkCredibility([])).not.toThrow();
  });
});

// C124: lexical groundedness. Sources below are real-shaped Wikipedia intro extracts.
describe("assessGroundedness", () => {
  const paging: EvidenceItem = {
    url: "https://en.wikipedia.org/w/index.php?curid=311193",
    title: "Memory paging",
    snippet:
      "In computer operating systems, memory paging is a memory management scheme that allows the physical " +
      "memory used by a program to be non-contiguous. Pages are typically 4096 bytes in size.",
    credibility: 0.9,
  };
  const cite = (claim: string, url = paging.url) => ({ url, claim });

  it("grounds a claim whose content words are in the cited source, paraphrased word order included", () => {
    const report = assessGroundedness([cite("Paging lets a program's physical memory be non-contiguous.")], [paging]);
    expect(report.verdicts[0]).toMatchObject({ verdict: "grounded" });
    expect(report.grounded).toBe(1);
  });

  it("rejects a claim the source does not say, even though it cites a real source", () => {
    const report = assessGroundedness(
      [cite("Paging was invented at Manchester University for the Atlas computer.")],
      [paging],
    );
    expect(report.verdicts[0]).toMatchObject({ verdict: "ungrounded" });
  });

  it("rejects an invented number even when every other word matches", () => {
    const report = assessGroundedness([cite("Pages are typically 8192 bytes in size.")], [paging]);
    expect(report.verdicts[0]).toMatchObject({ verdict: "ungrounded", reason: "number 8192 not in the source" });
    expect(assessGroundedness([cite("Pages are typically 4096 bytes in size.")], [paging]).grounded).toBe(1);
  });

  it("does not judge a claim too short to judge, and never counts it as grounded", () => {
    const report = assessGroundedness([cite("Paging.")], [paging]);
    expect(report.verdicts[0]).toMatchObject({ verdict: "unjudged" });
    expect(report.grounded).toBe(0);
  });

  it("treats a citation to a url that is not one of the node's sources as ungrounded", () => {
    const report = assessGroundedness([cite("Paging divides memory into pages.", "https://elsewhere.test/x")], [paging]);
    expect(report.verdicts[0]).toMatchObject({ verdict: "ungrounded", reason: "not one of the node's sources" });
  });

  it("checks each citation against ITS OWN source, not against all evidence", () => {
    const other: EvidenceItem = { ...paging, url: "https://en.wikipedia.org/w/index.php?curid=1", snippet: "Unrelated." };
    const report = assessGroundedness([cite("Paging lets physical memory be non-contiguous.", other.url)], [paging, other]);
    expect(report.verdicts[0]).toMatchObject({ verdict: "ungrounded" });
  });
});

// C125: quiz sanity - the problems a schema cannot catch and a learner would.
describe("checkQuizSanity", () => {
  const url = "https://en.wikipedia.org/w/index.php?curid=1";
  const allowed = new Set([url]);
  const q = (question: string, options = ["Pages", "Segments", "Heaps", "Stacks"], answerIndex = 0) => ({
    question,
    options,
    answerIndex,
    explanation: "Because.",
    evidenceUrl: url,
  });
  const good = [q("What is a page?"), q("What does an MMU do?"), q("What is a TLB?")];

  it("accepts a well-formed set", () => {
    expect(checkQuizSanity(good, allowed)).toEqual([]);
  });

  it("flags two options that differ only in case or spacing", () => {
    expect(checkQuizSanity([q("What is a page?", ["Pages", "pages ", "Heaps", "Stacks"]), good[1]!, good[2]!], allowed)).toEqual([
      "question 1: duplicate options",
    ]);
  });

  it("flags a duplicated question, a wrong count, an out-of-range answer and a foreign url", () => {
    expect(checkQuizSanity([good[0]!, good[0]!, good[2]!], allowed)).toContain("duplicate questions");
    expect(checkQuizSanity(good.slice(0, 2), allowed)).toContain(`2 questions, expected ${QUIZ_CONFIG.QUESTIONS_PER_TOPIC}`);
    expect(checkQuizSanity([q("What is a page?", undefined, 4), good[1]!, good[2]!], allowed)).toContain(
      "question 1: answer index out of range",
    );
    expect(checkQuizSanity(good, new Set(["https://other.test"]))).toContain("question 1: cites a url that is not a source");
  });
});

describe("guardArticle", () => {
  const source: EvidenceItem = {
    url: "https://en.wikipedia.org/w/index.php?curid=2",
    title: "Translation lookaside buffer",
    snippet: "A translation lookaside buffer (TLB) is a memory cache that stores recent translations of virtual memory to physical addresses.",
    credibility: 0.9,
  };
  const question = (text: string) => ({
    question: text,
    options: ["A cache", "A disk", "A register", "A bus"],
    answerIndex: 0,
    explanation: "It caches translations.",
    evidenceUrl: source.url,
  });

  it("drops ungrounded citations, keeps grounded and unjudged ones, and never touches the article text", () => {
    const { draft, report } = guardArticle(
      {
        contentMd: "The TLB caches translations.",
        citations: [
          { url: source.url, claim: "A TLB is a memory cache storing recent virtual-to-physical translations." },
          { url: source.url, claim: "The TLB was patented by IBM in 1972 for mainframes." },
          { url: source.url, claim: "TLB." },
        ],
      },
      [source],
    );
    expect(draft.contentMd).toBe("The TLB caches translations.");
    expect(draft.citations.map((c) => c.claim)).toEqual([
      "A TLB is a memory cache storing recent virtual-to-physical translations.",
      "TLB.",
    ]);
    expect(report.groundedness).toMatchObject({ grounded: 1, ungrounded: 1, unjudged: 1 });
  });

  it("drops a quiz with a sanity problem and keeps a sound one", () => {
    const sound = [question("What is a TLB?"), question("What does a TLB store?"), question("Where do translations go?")];
    const kept = guardArticle({ contentMd: "x", citations: [], questions: sound }, [source]);
    expect(kept.draft.questions).toHaveLength(3);
    const broken = guardArticle({ contentMd: "x", citations: [], questions: [sound[0]!, sound[0]!, sound[2]!] }, [source]);
    expect(broken.draft.questions).toBeUndefined();
    expect(broken.report.quizProblems).toContain("duplicate questions");
  });

  it("reports no quiz problem for an article that legitimately has no quiz (C80)", () => {
    expect(guardArticle({ contentMd: "x", citations: [], questions: [] }, [source]).report.quizProblems).toEqual([]);
  });
});

describe("createGuardrailAgent", () => {
  it("exposes the same rules through the agent factory", () => {
    const agent = createGuardrailAgent();
    const evidence = [source("https://a.example/1", 0.9), source("https://b.example/2", 0.9)];
    expect(agent.assessCredibility(evidence).verified).toBe(true);
    expect(agent.checkCredibility(evidence).verified).toBe(true);
    expect(agent.assessGroundedness([], evidence)).toMatchObject({ grounded: 0, ungrounded: 0, unjudged: 0 });
  });
});

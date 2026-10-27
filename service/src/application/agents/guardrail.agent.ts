import { CREDIBILITY, GROUNDEDNESS, QUIZ_CONFIG } from "../../config/constants";
import { sourceIdentity } from "../../domain/credibility/credibility-scorer";
import type { ArticleOutput, WriterOutput } from "../../domain/schemas/article.schema";
import type { EvidenceItem } from "../../domain/schemas/evidence.schema";
import type { QuizQuestion } from "../../domain/schemas/quiz.schema";
import { contentWords } from "../../shared/words";

export type CredibilityAssessment = {
  // The gate: at least CREDIBILITY.MIN_CREDIBLE_SOURCES sources scoring >= CREDIBILITY.MIN_SCORE.
  verified: boolean;
  credibleCount: number;
  // Informational only, never gating - see the note on `distinct` below. Surfacing it lets a later phase
  // (or a human reading the logs) see that a node rests entirely on one site.
  distinctDomains: number;
  // Only the sources that cleared MIN_SCORE, best first: what the writer is allowed to cite.
  credible: EvidenceItem[];
};

// What "distinct sources" counts
// ------------------------------
// docs/article-generation.md says "at least 2 distinct sources scoring >= 0.6". DISTINCT DOCUMENTS, not
// distinct domains. That is forced by the default provider: SEARCH_PROVIDER=wikipedia returns only
// wikipedia.org URLs, so a distinct-DOMAIN rule would make the gate unreachable and mark every article
// unverified - a guardrail that always fails teaches nothing. Two different Wikipedia articles are two
// sources here. `distinctDomains` is still reported so single-site evidence is visible rather than hidden,
// and a future multi-provider setup can tighten the rule on real data.
export function assessCredibility(evidence: readonly EvidenceItem[]): CredibilityAssessment {
  const credible = evidence
    .filter((item) => item.credibility >= CREDIBILITY.MIN_SCORE)
    .sort((a, b) => b.credibility - a.credibility);

  const domains = new Set<string>();
  for (const item of credible) {
    const host = sourceIdentity(item.url);
    if (host !== undefined) domains.add(host);
  }

  return {
    verified: credible.length >= CREDIBILITY.MIN_CREDIBLE_SOURCES,
    credibleCount: credible.length,
    distinctDomains: domains.size,
    credible,
  };
}

// The gate as the article pass uses it. It deliberately NEVER throws and never drops the node: a node that
// fails still gets an article, marked unverified (docs/article-generation.md, "it is not dropped"). The
// writer is handed only the credible subset either way, so an unverified article is one written from thin
// evidence - not one written from bad evidence.
export function checkCredibility(evidence: readonly EvidenceItem[]): CredibilityAssessment {
  return assessCredibility(evidence);
}

type Citation = ArticleOutput["citations"][number];

export type CitationVerdict = {
  citation: Citation;
  // grounded   - the cited source contains enough of the claim's content words, and every number in it;
  // ungrounded - it does not (or the source is not one of the node's): the citation is dropped (C124);
  // unjudged   - the claim is too short to judge lexically; kept, never counted as grounded.
  verdict: "grounded" | "ungrounded" | "unjudged";
  // Share of the claim's content words found in the cited source, 0..1.
  score: number;
  reason?: string;
};

export type GroundednessReport = {
  verdicts: CitationVerdict[];
  grounded: number;
  ungrounded: number;
  unjudged: number;
};

// Groundedness, lexically (C124): does each citation's CLAIM appear to come from the source it cites? A model
// can cite a real source for a sentence that source never says - that is still a hallucination, merely one
// with a real link attached, and it is the kind a reader is least likely to catch. Pure and deterministic:
// the share of the claim's content words (`contentWords`) present in the cited source's title + text must
// reach GROUNDEDNESS.MIN_OVERLAP, and EVERY number in the claim must appear in the source, because an
// invented figure is the most damaging form. A claim with fewer than GROUNDEDNESS.MIN_CLAIM_WORDS content
// words cannot be judged this way and is reported as such rather than guessed at.
//
// What it cannot do: tell a faithful paraphrase that uses different words from an invention. That is why the
// thresholds are calibrated on real output, and why a verdict only ever DROPS a citation - it never rewrites
// or removes article text.
export function assessGroundedness(
  citations: readonly Citation[],
  evidence: readonly EvidenceItem[],
): GroundednessReport {
  const sources = new Map(evidence.map((item) => [item.url, new Set(contentWords(`${item.title} ${item.snippet}`))]));
  const verdicts = citations.map((citation): CitationVerdict => {
    const source = sources.get(citation.url);
    if (source === undefined) return { citation, verdict: "ungrounded", score: 0, reason: "not one of the node's sources" };
    const claim = [...new Set(contentWords(citation.claim))];
    const missingNumber = claim.find((word) => /^\p{N}+$/u.test(word) && !source.has(word));
    if (missingNumber !== undefined) {
      return { citation, verdict: "ungrounded", score: 0, reason: `number ${missingNumber} not in the source` };
    }
    const found = claim.filter((word) => source.has(word)).length;
    const score = claim.length === 0 ? 0 : found / claim.length;
    if (claim.length < GROUNDEDNESS.MIN_CLAIM_WORDS) return { citation, verdict: "unjudged", score };
    return score >= GROUNDEDNESS.MIN_OVERLAP
      ? { citation, verdict: "grounded", score }
      : { citation, verdict: "ungrounded", score, reason: "too few of the claim's words are in the source" };
  });
  return {
    verdicts,
    grounded: verdicts.filter((v) => v.verdict === "grounded").length,
    ungrounded: verdicts.filter((v) => v.verdict === "ungrounded").length,
    unjudged: verdicts.filter((v) => v.verdict === "unjudged").length,
  };
}

const normalized = (text: string): string => text.trim().replace(/\s+/g, " ").toLowerCase();

// Quiz sanity (C125): the structural problems a schema cannot catch and a learner would. Returns every
// problem found; an empty list means the set is usable. A set with ANY problem is dropped whole - a quiz with
// two identical options or a duplicated question teaches nothing - and it is never sent back for a repair,
// which would spend another call.
export function checkQuizSanity(
  questions: readonly QuizQuestion[] | undefined,
  allowedUrls: ReadonlySet<string>,
): string[] {
  if (questions === undefined) return ["no questions"];
  const problems: string[] = [];
  if (questions.length !== QUIZ_CONFIG.QUESTIONS_PER_TOPIC) {
    problems.push(`${questions.length} questions, expected ${QUIZ_CONFIG.QUESTIONS_PER_TOPIC}`);
  }
  if (new Set(questions.map((q) => normalized(q.question))).size !== questions.length) {
    problems.push("duplicate questions");
  }
  questions.forEach((q, i) => {
    if (new Set(q.options.map(normalized)).size !== q.options.length) problems.push(`question ${i + 1}: duplicate options`);
    if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex >= q.options.length) {
      problems.push(`question ${i + 1}: answer index out of range`);
    }
    if (!allowedUrls.has(q.evidenceUrl)) problems.push(`question ${i + 1}: cites a url that is not a source`);
  });
  return problems;
}

export type ArticleGuardReport = {
  groundedness: GroundednessReport;
  quizProblems: string[];
};

// Everything the writer's draft must pass before it is stored, in one place: ungrounded citations are
// dropped (C124) and a quiz with any sanity problem is dropped (C125). The article TEXT is never touched -
// a guardrail that rewrote content would be a second, unsourced author.
export function guardArticle(
  draft: WriterOutput,
  evidence: readonly EvidenceItem[],
): { draft: WriterOutput; report: ArticleGuardReport } {
  const groundedness = assessGroundedness(draft.citations, evidence);
  const { questions, ...rest } = draft;
  // An absent quiz is a legitimate state (C80), not a problem to report.
  const quizProblems =
    questions === undefined || questions.length === 0
      ? []
      : checkQuizSanity(questions, new Set(evidence.map((item) => item.url)));
  const keepQuiz = questions !== undefined && questions.length > 0 && quizProblems.length === 0;
  return {
    draft: {
      ...rest,
      citations: groundedness.verdicts.filter((v) => v.verdict !== "ungrounded").map((v) => v.citation),
      ...(keepQuiz ? { questions } : {}),
    },
    report: { groundedness, quizProblems },
  };
}

export type GuardrailAgent = {
  assessCredibility(evidence: readonly EvidenceItem[]): CredibilityAssessment;
  checkCredibility(evidence: readonly EvidenceItem[]): CredibilityAssessment;
  assessGroundedness(citations: readonly Citation[], evidence: readonly EvidenceItem[]): GroundednessReport;
  checkQuizSanity(questions: readonly QuizQuestion[] | undefined, allowedUrls: ReadonlySet<string>): string[];
  guardArticle(draft: WriterOutput, evidence: readonly EvidenceItem[]): { draft: WriterOutput; report: ArticleGuardReport };
};

// A factory for symmetry with the other agents, though this one needs no ports: every rule here is pure,
// so the whole guardrail is testable without a fake (agents are factories - .claude/CLAUDE.md).
export function createGuardrailAgent(): GuardrailAgent {
  return { assessCredibility, checkCredibility, assessGroundedness, checkQuizSanity, guardArticle };
}

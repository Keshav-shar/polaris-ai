import { CREDIBILITY, QUIZ_CONFIG } from "../../config/constants";
import { sourceIdentity } from "../../domain/credibility/credibility-scorer";
import type { WriterOutput } from "../../domain/schemas/article.schema";
import type { EvidenceItem } from "../../domain/schemas/evidence.schema";
import type { QuizQuestion } from "../../domain/schemas/quiz.schema";

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
// distinct domains. That was forced by a Wikipedia-only provider, and is kept under several providers (C146)
// because a provider can still fail for one lesson and leave only Wikipedia: a distinct-DOMAIN rule would then
// mark that article unverified for an outage, not for its evidence. `distinctDomains` is reported so
// single-site evidence stays visible, and the rule can be tightened on measured multi-provider data.
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
  // Citations whose url is not one of the node's sources: an invented link, dropped (C147).
  foreignCitations: number;
  quizProblems: string[];
};

// Everything the writer's draft must pass before it is stored, in one place. Since C147 this is STRUCTURAL only:
// a citation is kept when its url is one of the node's sources - a set lookup, no source text is re-read - and a
// quiz with any sanity problem is dropped (C125). The lexical re-check of each citation's claim against its
// source (C124) no longer runs here: citations and comparisons come from the one multi-source search (C146), and
// groundedness is measured offline by scripts/writer-eval.ts instead. The article TEXT is never touched - a
// guardrail that rewrote content would be a second, unsourced author.
export function guardArticle(
  draft: WriterOutput,
  evidence: readonly EvidenceItem[],
): { draft: WriterOutput; report: ArticleGuardReport } {
  const allowed = new Set(evidence.map((item) => item.url));
  const citations = draft.citations.filter((citation) => allowed.has(citation.url));
  const { questions, ...rest } = draft;
  // An absent quiz is a legitimate state (C80), not a problem to report.
  const quizProblems = questions === undefined || questions.length === 0 ? [] : checkQuizSanity(questions, allowed);
  const keepQuiz = questions !== undefined && questions.length > 0 && quizProblems.length === 0;
  return {
    draft: { ...rest, citations, ...(keepQuiz ? { questions } : {}) },
    report: { foreignCitations: draft.citations.length - citations.length, quizProblems },
  };
}

export type GuardrailAgent = {
  assessCredibility(evidence: readonly EvidenceItem[]): CredibilityAssessment;
  checkCredibility(evidence: readonly EvidenceItem[]): CredibilityAssessment;
  checkQuizSanity(questions: readonly QuizQuestion[] | undefined, allowedUrls: ReadonlySet<string>): string[];
  guardArticle(draft: WriterOutput, evidence: readonly EvidenceItem[]): { draft: WriterOutput; report: ArticleGuardReport };
};

// A factory for symmetry with the other agents, though this one needs no ports: every rule here is pure,
// so the whole guardrail is testable without a fake (agents are factories - .claude/CLAUDE.md).
export function createGuardrailAgent(): GuardrailAgent {
  return { assessCredibility, checkCredibility, checkQuizSanity, guardArticle };
}

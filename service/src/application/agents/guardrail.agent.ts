import { CREDIBILITY } from "../../config/constants";
import { sourceIdentity } from "../../domain/credibility/credibility-scorer";
import type { EvidenceItem } from "../../domain/schemas/evidence.schema";

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

export type GroundednessVerdict = {
  // `skipped` is honest about the stub: it is not a pass, and a later phase replacing this must not find
  // callers that already treat it as one.
  status: "skipped";
  reason: string;
};

// Groundedness (does each claim follow from the cited evidence?) is the next guardrail leg and is stubbed
// until after the MVP, as specified in docs/article-generation.md and agents-and-prompts.md. It is an
// explicit no-op rather than an absent function so the call site exists and its replacement is a
// one-file change with a regression test already around it.
export function checkGroundedness(): GroundednessVerdict {
  return { status: "skipped", reason: "groundedness checking is stubbed until after the MVP" };
}

export type GuardrailAgent = {
  assessCredibility(evidence: readonly EvidenceItem[]): CredibilityAssessment;
  checkCredibility(evidence: readonly EvidenceItem[]): CredibilityAssessment;
  checkGroundedness(): GroundednessVerdict;
};

// A factory for symmetry with the other agents, though this one needs no ports: every rule here is pure,
// so the whole guardrail is testable without a fake (agents are factories - .claude/CLAUDE.md).
export function createGuardrailAgent(): GuardrailAgent {
  return { assessCredibility, checkCredibility, checkGroundedness };
}

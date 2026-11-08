import type { ArticleOutput } from "../src/domain/schemas/article.schema";
import type { EvidenceItem } from "../src/domain/schemas/evidence.schema";
import { GROUNDEDNESS } from "../src/config/constants";
import { contentWords } from "../src/shared/words";

// OFFLINE QUALITY METRIC since C147 - no longer on the write path. Moved here unchanged from
// application/agents/guardrail.agent.ts so scripts/writer-eval.ts can still report how many citations a model's
// sources actually support (docs/quality-eval.md).

type Citation = ArticleOutput["citations"][number];

export type CitationVerdict = {
  citation: Citation;
  // grounded   - the cited source contains enough of the claim's content words, and every number in it;
  // ungrounded - it does not (or the source is not one of the node's): counted against the arm (C124);
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

import { describe, expect, it } from "vitest";
import {
  assessCredibility,
  checkCredibility,
  checkGroundedness,
  createGuardrailAgent,
} from "../../../../src/application/agents/guardrail.agent";
import { CREDIBILITY } from "../../../../src/config/constants";
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

describe("checkGroundedness", () => {
  it("reports itself as skipped, not as a pass", () => {
    // Guards against a caller treating the stub as a green light before the real check exists.
    const verdict = checkGroundedness();
    expect(verdict.status).toBe("skipped");
    expect(verdict.reason).toMatch(/stub/i);
  });
});

describe("createGuardrailAgent", () => {
  it("exposes the same rules through the agent factory", () => {
    const agent = createGuardrailAgent();
    const evidence = [source("https://a.example/1", 0.9), source("https://b.example/2", 0.9)];
    expect(agent.assessCredibility(evidence).verified).toBe(true);
    expect(agent.checkCredibility(evidence).verified).toBe(true);
    expect(agent.checkGroundedness().status).toBe("skipped");
  });
});

import { describe, expect, it } from "vitest";
import type { EvidenceItem } from "../../../src/domain/schemas/evidence.schema";
import { assessGroundedness } from "../../../scripts/groundedness-metric";

// Moved from guardrail.agent.test.ts with the metric (C147): it now measures writer output offline
// (scripts/writer-eval.ts) and no longer drops anything on the write path.
// C124: lexical groundedness, as an offline metric. Sources below are real-shaped Wikipedia intro extracts.
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


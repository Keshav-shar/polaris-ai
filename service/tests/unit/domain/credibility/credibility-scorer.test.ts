import { describe, expect, it } from "vitest";
import { CREDIBILITY } from "../../../../src/config/constants";
import { scoreSource, sourceIdentity } from "../../../../src/domain/credibility/credibility-scorer";

describe("scoreSource", () => {
  // What actually matters is which side of the gate a source lands on, so the table asserts that rather
  // than exact numbers - the heuristic can be retuned without rewriting every case.
  const above: [string, string][] = [
    ["government", "https://www.nih.gov/about"],
    ["government subdomain", "https://data.cdc.gov/dataset/x"],
    ["uk government", "https://www.gov.uk/guidance/thing"],
    ["university", "https://web.mit.edu/course/6.006"],
    ["uk academic", "https://www.cl.cam.ac.uk/teaching/os"],
    ["reference publisher", "https://www.britannica.com/science/photosynthesis"],
    ["journal", "https://www.nature.com/articles/s41586"],
    ["preprint server", "https://arxiv.org/abs/1706.03762"],
    ["wikipedia", "https://en.wikipedia.org/w/index.php?curid=12345"],
  ];
  const below: [string, string][] = [
    ["forum", "https://www.reddit.com/r/compsci/comments/abc"],
    ["q&a", "https://www.quora.com/What-is-paging"],
    ["self-publishing", "https://medium.com/@someone/a-post"],
    ["code q&a", "https://stackoverflow.com/questions/1"],
    ["video", "https://www.youtube.com/watch?v=abc"],
    ["unknown domain", "https://some-random-blog.example/post"],
  ];

  it.each(above)("scores a %s source at or above the gate", (_label, url) => {
    expect(scoreSource(url)).toBeGreaterThanOrEqual(CREDIBILITY.MIN_SCORE);
  });

  it.each(below)("scores a %s source below the gate", (_label, url) => {
    expect(scoreSource(url)).toBeLessThan(CREDIBILITY.MIN_SCORE);
  });

  it("ranks government and academic above encyclopedias, and encyclopedias above forums", () => {
    expect(scoreSource("https://nih.gov/x")).toBeGreaterThan(scoreSource("https://en.wikipedia.org/x"));
    expect(scoreSource("https://en.wikipedia.org/x")).toBeGreaterThan(scoreSource("https://reddit.com/x"));
  });

  it("scores a malformed or non-web URL 0, so it can never help a node pass the gate", () => {
    // 0 rather than the unknown-domain default: these cannot be cited at all.
    expect(scoreSource("not a url")).toBe(0);
    expect(scoreSource("")).toBe(0);
    expect(scoreSource("mailto:someone@example.com")).toBe(0);
    expect(scoreSource("file:///etc/passwd")).toBe(0);
    expect(scoreSource("javascript:alert(1)")).toBe(0);
  });

  it("does not let a lookalike domain inherit a listed domain's score", () => {
    // Suffix matching must be dot-bounded, or `notreddit.com` would be scored as reddit - and, worse,
    // `evil-nih.gov.attacker.example` would be scored as a government source.
    expect(scoreSource("https://notreddit.com/x")).toBe(scoreSource("https://some-random-blog.example/x"));
    expect(scoreSource("https://nih.gov.attacker.example/x")).toBeLessThan(CREDIBILITY.MIN_SCORE);
  });

  it("ignores www. and letter case", () => {
    expect(scoreSource("https://WWW.Britannica.COM/x")).toBe(scoreSource("https://britannica.com/x"));
  });
});

describe("sourceIdentity", () => {
  it("reports the host, so two pages of one site can be recognised as one site", () => {
    expect(sourceIdentity("https://en.wikipedia.org/w/index.php?curid=1")).toBe("en.wikipedia.org");
    expect(sourceIdentity("https://www.nature.com/articles/a")).toBe("nature.com");
  });

  it("is undefined for a URL that has no usable host", () => {
    expect(sourceIdentity("not a url")).toBeUndefined();
  });
});

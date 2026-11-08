import { describe, expect, it } from "vitest";
import { buildWriterUserPrompt, WRITER_SYSTEM_PROMPT } from "../../../../src/application/agents/writer.prompt";
import type { ArticleContext } from "../../../../src/domain/schemas/article.schema";

const context: ArticleContext = {
  node: { id: "00000000-0000-4000-8000-000000000001", topic: "Photosynthesis", depth: 0, brief: "How plants make sugar." },
  parent: null,
  isLeaf: true,
  children: [],
  evidence: [
    { url: "https://doi.org/10.1017/x", title: "Light (CUP)", snippet: "An abstract.", credibility: 0.9, provider: "crossref" },
    { url: "https://www.reuters.com/a", title: "Heat", snippet: "News headline: Heat", credibility: 0.7, provider: "gdelt" },
    { url: "https://en.wikipedia.org/w/index.php?curid=1", title: "Old row", snippet: "Intro.", credibility: 0.75 },
  ],
};

// C146: the writer sees each source's kind and provider, and is told how to weigh and compare them.
describe("writer prompt sources", () => {
  it("marks every source with its kind and, when known, its provider - inside the sources data block", () => {
    const prompt = buildWriterUserPrompt(context, { minWords: 100, maxWords: 200 });
    const sources = prompt.slice(prompt.indexOf("<sources>"), prompt.indexOf("</sources>"));
    expect(sources).toContain("kind: scholarly from crossref");
    expect(sources).toContain("kind: news from gdelt");
    // Evidence stored before C146 has no provider: still a reference source, no "from".
    expect(sources).toMatch(/Old row\n {4}kind: reference\n/);
  });

  it("tells the writer news is a headline for context only, and to compare sources of different kinds", () => {
    expect(WRITER_SYSTEM_PROMPT).toContain("news is a HEADLINE only");
    expect(WRITER_SYSTEM_PROMPT).toContain("Where sources of different kinds agree on a point, or disagree");
  });
});

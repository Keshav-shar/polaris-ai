import { describe, expect, it } from "vitest";
import { ArticleOutput } from "../../../../src/domain/schemas/article.schema";
import { EvidenceItem } from "../../../../src/domain/schemas/evidence.schema";
import { QuizQuestion } from "../../../../src/domain/schemas/quiz.schema";
import { HttpUrl } from "../../../../src/domain/schemas/url.schema";

// These three fields are the only strings in the system that become a clickable `href`, and none of them
// is ours: a search provider supplies the evidence and a model copies it into citations and questions.
describe("HttpUrl", () => {
  it("accepts the web urls the search adapters actually return", () => {
    expect(HttpUrl.safeParse("https://en.wikipedia.org/w/index.php?curid=1").success).toBe(true);
    expect(HttpUrl.safeParse("http://example.org/a?b=c#d").success).toBe(true);
  });

  it("rejects a scheme that would execute instead of navigate", () => {
    // z.url() alone accepts every one of these: the WHATWG parser it uses finds them well-formed.
    for (const hostile of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      expect(HttpUrl.safeParse(hostile).success).toBe(false);
    }
  });

  it("rejects what is not a url at all", () => {
    expect(HttpUrl.safeParse("not a url").success).toBe(false);
    expect(HttpUrl.safeParse("").success).toBe(false);
  });

  it("guards every field that reaches an href", () => {
    const evidence = { url: "javascript:alert(1)", title: "t", snippet: "s", credibility: 0.9 };
    expect(EvidenceItem.safeParse(evidence).success).toBe(false);

    const article = { contentMd: "a", citations: [{ url: "javascript:alert(1)", claim: "c" }] };
    expect(ArticleOutput.safeParse(article).success).toBe(false);

    const question = {
      question: "q?",
      options: ["a", "b", "c", "d"],
      answerIndex: 0,
      explanation: "because",
      evidenceUrl: "javascript:alert(1)",
    };
    expect(QuizQuestion.safeParse(question).success).toBe(false);
  });
});

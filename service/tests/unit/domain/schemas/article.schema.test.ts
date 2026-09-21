import { describe, expect, it } from "vitest";
import { ArticleContext, ArticleOutput } from "../../../../src/domain/schemas/article.schema";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

const context = {
  node: { id: "00000000-0000-4000-8000-000000000001", topic: "Leaf", depth: 2, brief: "b" },
  parent: { topic: "Parent", brief: "pb" },
  isLeaf: true,
  evidence: [{ url: "https://example.org/a", title: "A", snippet: "s", credibility: 0.8 }],
};

describe("ArticleContext", () => {
  it("accepts node + parent brief + evidence", () => {
    expect(ArticleContext.safeParse(context).success).toBe(true);
  });

  it("accepts a root with no parent", () => {
    expect(ArticleContext.safeParse({ ...context, parent: null }).success).toBe(true);
  });

  it("rejects a children field so children's material never reaches the writer", () => {
    expect(ArticleContext.safeParse({ ...context, children: [] }).success).toBe(false);
    expect(ArticleContext.safeParse({ ...context, node: { ...context.node, children: ["x"] } }).success).toBe(false);
  });
});

describe("ArticleOutput", () => {
  it("accepts 100 words and rejects 101", () => {
    expect(ArticleOutput.safeParse({ contentMd: words(100), citations: [] }).success).toBe(true);
    expect(ArticleOutput.safeParse({ contentMd: words(101), citations: [] }).success).toBe(false);
  });

  it("does not count citations toward the limit", () => {
    const citations = Array.from({ length: 20 }, (_, i) => ({ url: `https://example.org/${i}`, claim: words(10) }));
    expect(ArticleOutput.safeParse({ contentMd: words(100), citations }).success).toBe(true);
  });

  it("rejects a citation without a valid URL", () => {
    expect(ArticleOutput.safeParse({ contentMd: "x", citations: [{ url: "nope", claim: "c" }] }).success).toBe(false);
  });
});

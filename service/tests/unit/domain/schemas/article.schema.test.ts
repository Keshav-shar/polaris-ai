import { describe, expect, it } from "vitest";
import { ARTICLE } from "../../../../src/config/constants";
import { ArticleContext, ArticleOutput } from "../../../../src/domain/schemas/article.schema";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

const context = {
  node: { id: "00000000-0000-4000-8000-000000000001", topic: "Leaf", depth: 2, brief: "b" },
  parent: { topic: "Parent", brief: "pb" },
  isLeaf: true,
  children: [],
  evidence: [{ url: "https://example.org/a", title: "A", snippet: "s", credibility: 0.8 }],
};

describe("ArticleContext", () => {
  it("accepts node + parent brief + evidence", () => {
    expect(ArticleContext.safeParse(context).success).toBe(true);
  });

  it("accepts a root with no parent", () => {
    expect(ArticleContext.safeParse({ ...context, parent: null }).success).toBe(true);
  });

  it("accepts children as bare topics, which is what lets an article signpost them", () => {
    // The invariant changed twice: C86 made it "children named, never taught" as topic + brief; C91 cut
    // the brief, because the article is written while those children are still being expanded.
    const withKids = { ...context, isLeaf: false, children: [{ topic: "Paging" }] };
    expect(ArticleContext.safeParse(withKids).success).toBe(true);
  });

  it("rejects anything on a child beyond its topic", () => {
    // THE guard that keeps the relaxation honest: a child's brief, its article, its evidence or its own
    // children must not be smuggleable into the writer's context.
    const smuggled = (child: Record<string, unknown>) =>
      ArticleContext.safeParse({ ...context, isLeaf: false, children: [child] }).success;
    expect(smuggled({ topic: "t" })).toBe(true);
    expect(smuggled({ topic: "t", brief: "b" })).toBe(false);
    expect(smuggled({ topic: "t", contentMd: "the child's whole article" })).toBe(false);
    expect(smuggled({ topic: "t", children: [{ topic: "grandchild" }] })).toBe(false);
    expect(smuggled({ topic: "t", evidence: [] })).toBe(false);
    expect(smuggled({})).toBe(false);
  });

  it("still rejects a children field on the NODE itself", () => {
    expect(ArticleContext.safeParse({ ...context, node: { ...context.node, children: ["x"] } }).success).toBe(false);
  });

  it("still rejects an unknown top-level key", () => {
    expect(ArticleContext.safeParse({ ...context, childArticles: ["x"] }).success).toBe(false);
  });
});

describe("ArticleOutput", () => {
  it("accepts the guard limit and rejects one word past it", () => {
    // Driven from the constant, not a literal: ARTICLE.MAX_WORDS is now a runaway guard rather than a
    // target (C85), and a test hardcoding the old 100 would break every time the guard is retuned.
    expect(ArticleOutput.safeParse({ contentMd: words(ARTICLE.MAX_WORDS), citations: [] }).success).toBe(true);
    expect(ArticleOutput.safeParse({ contentMd: words(ARTICLE.MAX_WORDS + 1), citations: [] }).success).toBe(false);
  });

  it("accepts a real, long, structured article", () => {
    const article = `## Heading

A paragraph with **bold** and \`code\`.

- bullet one
- bullet two`;
    expect(ArticleOutput.safeParse({ contentMd: article, citations: [] }).success).toBe(true);
  });

  it("does not count citations toward the limit", () => {
    const citations = Array.from({ length: 20 }, (_, i) => ({ url: `https://example.org/${i}`, claim: words(10) }));
    expect(ArticleOutput.safeParse({ contentMd: words(ARTICLE.MAX_WORDS), citations }).success).toBe(true);
  });

  it("rejects a citation without a valid URL", () => {
    expect(ArticleOutput.safeParse({ contentMd: "x", citations: [{ url: "nope", claim: "c" }] }).success).toBe(false);
  });
});

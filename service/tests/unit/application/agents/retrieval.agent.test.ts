import { describe, expect, it } from "vitest";
import { buildSearchQuery, createRetrievalAgent } from "../../../../src/application/agents/retrieval.agent";
import type { SearchPort, SearchResult } from "../../../../src/application/ports/search.port";
import { RETRIEVAL } from "../../../../src/config/constants";

function fakeSearch(results: SearchResult[]) {
  const queries: { query: string; maxResults: number }[] = [];
  const search: SearchPort = {
    async search(query, maxResults) {
      queries.push({ query, maxResults });
      return results;
    },
  };
  return { search, queries };
}

const hit = (url: string, title = "t", snippet = "s"): SearchResult => ({ url, title, snippet });

describe("buildSearchQuery", () => {
  it("adds the parent topic, which is what makes a bare subtopic searchable", () => {
    // "Paging" alone retrieves badly; "Paging Memory management" retrieves the right pages.
    expect(buildSearchQuery("Paging", "Memory management")).toBe("Paging Memory management");
  });

  it("uses the topic alone at the root", () => {
    expect(buildSearchQuery("Unix", null)).toBe("Unix");
  });

  it("does not repeat a parent that merely restates the topic", () => {
    expect(buildSearchQuery("Unix", "unix")).toBe("Unix");
    expect(buildSearchQuery("Unix", "   ")).toBe("Unix");
  });
});

describe("createRetrievalAgent", () => {
  it("scores each result with the pure domain rule", async () => {
    const { search } = fakeSearch([hit("https://www.nih.gov/a"), hit("https://reddit.com/b")]);
    const { items: evidence } = await createRetrievalAgent({ search }).retrieve({ topic: "T", parentTopic: null });
    expect(evidence.map((e) => e.url)).toEqual(["https://www.nih.gov/a", "https://reddit.com/b"]);
    expect(evidence[0]!.credibility).toBeGreaterThan(evidence[1]!.credibility);
  });

  it("returns the strongest sources first, so a truncated prompt keeps the best", async () => {
    const { search } = fakeSearch([
      hit("https://medium.com/weak"),
      hit("https://en.wikipedia.org/mid"),
      hit("https://www.nih.gov/strong"),
    ]);
    const { items: evidence } = await createRetrievalAgent({ search }).retrieve({ topic: "T", parentTopic: null });
    expect(evidence.map((e) => e.url)).toEqual([
      "https://www.nih.gov/strong",
      "https://en.wikipedia.org/mid",
      "https://medium.com/weak",
    ]);
  });

  it("dedupes the same page reached by two URLs", async () => {
    const { search } = fakeSearch([
      hit("https://en.wikipedia.org/wiki/Paging"),
      hit("https://en.wikipedia.org/wiki/Paging/"),
      hit("https://en.wikipedia.org/wiki/Paging#History"),
      hit("https://en.wikipedia.org/wiki/Memory"),
    ]);
    const { items: evidence } = await createRetrievalAgent({ search }).retrieve({ topic: "T", parentTopic: null });
    expect(evidence).toHaveLength(2);
  });

  it("keeps the query string, because ?curid= is what identifies a Wikipedia page", async () => {
    const { search } = fakeSearch([
      hit("https://en.wikipedia.org/w/index.php?curid=1"),
      hit("https://en.wikipedia.org/w/index.php?curid=2"),
    ]);
    const { items: evidence } = await createRetrievalAgent({ search }).retrieve({ topic: "T", parentTopic: null });
    expect(evidence).toHaveLength(2);
  });

  it("drops a malformed result instead of letting it reach a citation", async () => {
    const { search } = fakeSearch([hit("not a url"), hit("https://www.nih.gov/ok")]);
    const { items: evidence } = await createRetrievalAgent({ search }).retrieve({ topic: "T", parentTopic: null });
    expect(evidence.map((e) => e.url)).toEqual(["https://www.nih.gov/ok"]);
  });

  it("asks for RETRIEVAL.MAX_RESULTS by default and never returns more", async () => {
    const many = Array.from({ length: 12 }, (_, i) => hit(`https://site${i}.example/p`));
    const { search, queries } = fakeSearch(many);
    const { items: evidence } = await createRetrievalAgent({ search }).retrieve({ topic: "T", parentTopic: null });
    expect(queries[0]!.maxResults).toBe(RETRIEVAL.MAX_RESULTS);
    expect(evidence.length).toBeLessThanOrEqual(RETRIEVAL.MAX_RESULTS);
  });

  it("carries the query and an injected timestamp, which is the evidence table's provenance", async () => {
    // This agent is the ONLY place that knows the query; it used to compute it and drop it, so no Phase 12
    // adapter could ever have populated `retrieval_query` (docs/conflicts.md C79).
    const { search } = fakeSearch([hit("https://www.nih.gov/a")]);
    const frozen = new Date("2026-09-22T10:00:00.000Z");
    const result = await createRetrievalAgent({ search, now: () => frozen }).retrieve({
      topic: "Paging",
      parentTopic: "Memory management",
    });
    expect(result.query).toBe("Paging Memory management");
    expect(result.retrievedAt).toBe("2026-09-22T10:00:00.000Z");
  });

  it("treats an empty result set as evidence-free, not as a failure", async () => {
    // The node still gets an article, marked unverified.
    const { search } = fakeSearch([]);
    await expect(
      createRetrievalAgent({ search }).retrieve({ topic: "T", parentTopic: null }),
    ).resolves.toMatchObject({ items: [] });
  });
});

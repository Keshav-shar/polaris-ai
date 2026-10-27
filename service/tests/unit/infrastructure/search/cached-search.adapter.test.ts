import { describe, expect, it } from "vitest";
import type { SearchPort, SearchResult } from "../../../../src/application/ports/search.port";
import { createCachedSearch } from "../../../../src/infrastructure/search/cached-search.adapter";

function counting(results: SearchResult[] = [{ url: "https://a.test/1", title: "A", snippet: "a" }]) {
  const queries: string[] = [];
  let fail = false;
  const search: SearchPort = {
    async search(query) {
      queries.push(query);
      if (fail) throw new Error("provider down");
      return results.map((r) => ({ ...r }));
    },
  };
  return {
    search,
    queries,
    failNext: () => {
      fail = true;
    },
    recover: () => {
      fail = false;
    },
  };
}

describe("createCachedSearch (C126)", () => {
  it("answers a repeated query from the cache, without calling the provider again", async () => {
    const inner = counting();
    const cached = createCachedSearch(inner.search);
    const first = await cached.search("paging", 5);
    const second = await cached.search("paging", 5);
    expect(second).toEqual(first);
    expect(inner.queries).toEqual(["paging"]);
  });

  it("keys on maxResults too, so a request for more results is not served a shorter list", async () => {
    const inner = counting();
    const cached = createCachedSearch(inner.search);
    await cached.search("paging", 1);
    await cached.search("paging", 5);
    expect(inner.queries).toHaveLength(2);
  });

  it("expires an entry after its TTL", async () => {
    let clock = 0;
    const inner = counting();
    const cached = createCachedSearch(inner.search, { ttlMs: 1_000, now: () => clock });
    await cached.search("paging", 5);
    clock = 1_001;
    await cached.search("paging", 5);
    expect(inner.queries).toHaveLength(2);
  });

  it("stays bounded: the least recently used entry goes first", async () => {
    const inner = counting();
    const cached = createCachedSearch(inner.search, { maxEntries: 2 });
    await cached.search("a", 5);
    await cached.search("b", 5);
    await cached.search("a", 5); // a is now the most recently used
    await cached.search("c", 5); // evicts b
    await cached.search("a", 5);
    await cached.search("b", 5);
    expect(inner.queries).toEqual(["a", "b", "c", "b"]);
  });

  it("never caches a failure: the next attempt really retries", async () => {
    const inner = counting();
    const cached = createCachedSearch(inner.search);
    inner.failNext();
    await expect(cached.search("paging", 5)).rejects.toThrow("provider down");
    inner.recover();
    await expect(cached.search("paging", 5)).resolves.toHaveLength(1);
    expect(inner.queries).toHaveLength(2);
  });

  it("hands out copies, so one caller cannot edit what the next is served", async () => {
    const cached = createCachedSearch(counting().search);
    const first = await cached.search("paging", 5);
    first[0]!.snippet = "tampered";
    expect((await cached.search("paging", 5))[0]!.snippet).toBe("a");
  });

  it("rejects a meaningless bound", () => {
    expect(() => createCachedSearch(counting().search, { maxEntries: 0 })).toThrow(RangeError);
  });
});

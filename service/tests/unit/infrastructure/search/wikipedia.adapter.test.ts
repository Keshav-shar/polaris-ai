import { describe, expect, it } from "vitest";
import { createWikipediaSearch, stripHtml } from "../../../../src/infrastructure/search/wikipedia.adapter";

// A captured MediaWiki `list=search` response: markup in the snippet, entities, and a pageid that is what
// the canonical URL is built from. No network in this suite.
const liveShape = {
  batchcomplete: "",
  query: {
    searchinfo: { totalhits: 2 },
    search: [
      {
        ns: 0,
        title: "Memory management",
        pageid: 19458,
        snippet:
          '<span class="searchmatch">Memory</span> <span class="searchmatch">management</span> ' +
          "is a form of resource management applied to computer &quot;memory&quot;.",
      },
      {
        ns: 0,
        title: "Virtual memory",
        pageid: 32552,
        snippet: "In computing, <span class=\"searchmatch\">virtual memory</span> is a memory &amp; storage technique.",
      },
    ],
  },
};

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  };
  return { impl, calls };
}

const config = { userAgent: "polaris-ai/0.1 (contact: test@example.com)" };

describe("createWikipediaSearch", () => {
  it("builds a list=search request carrying the User-Agent Wikipedia asks for", async () => {
    const { impl, calls } = fakeFetch(liveShape);
    await createWikipediaSearch(config, impl).search("Memory management Unix", 5);

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("action")).toBe("query");
    expect(url.searchParams.get("list")).toBe("search");
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("srsearch")).toBe("Memory management Unix");
    expect(url.searchParams.get("srlimit")).toBe("5");
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe(config.userAgent);
  });

  it("builds a canonical curid URL rather than a title URL", async () => {
    // A page retitled tomorrow keeps this URL. Citations are stored and read back much later, so a
    // title-based link would rot.
    const { impl } = fakeFetch(liveShape);
    const results = await createWikipediaSearch(config, impl).search("memory", 5);
    expect(results[0]!.url).toBe("https://en.wikipedia.org/w/index.php?curid=19458");
    expect(results[1]!.url).toBe("https://en.wikipedia.org/w/index.php?curid=32552");
  });

  it("strips the search markup and decodes entities out of snippets", async () => {
    // Snippets are quoted into a prompt as source text; tags a model might read as instructions have no
    // business in evidence.
    const { impl } = fakeFetch(liveShape);
    const results = await createWikipediaSearch(config, impl).search("memory", 5);
    expect(results[0]!.snippet).not.toMatch(/[<>]/);
    expect(results[0]!.snippet).toContain('computer "memory"');
    expect(results[1]!.snippet).toContain("memory & storage");
  });

  it("honours maxResults even if the provider returns more", async () => {
    const { impl } = fakeFetch(liveShape);
    const results = await createWikipediaSearch(config, impl).search("memory", 1);
    expect(results).toHaveLength(1);
  });

  it("throws a readable error on an HTTP failure", async () => {
    const { impl } = fakeFetch({}, 503);
    await expect(createWikipediaSearch(config, impl).search("memory", 5)).rejects.toThrow(/503/);
  });

  it("returns no results, rather than throwing, when the body is not the shape we expect", async () => {
    // A node with no sources still gets an unverified article; it must not fail the whole run over a
    // search response that changed shape.
    const { impl } = fakeFetch({ query: { search: "not an array" } });
    await expect(createWikipediaSearch(config, impl).search("memory", 5)).resolves.toEqual([]);
    const empty = fakeFetch({});
    await expect(createWikipediaSearch(config, empty.impl).search("memory", 5)).resolves.toEqual([]);
  });
});

describe("stripHtml", () => {
  it("removes tags, decodes entities and collapses whitespace", () => {
    expect(stripHtml('<span class="searchmatch">A</span>  &amp;  <b>B</b>')).toBe("A & B");
    expect(stripHtml("&lt;script&gt;")).toBe("<script>");
    expect(stripHtml("")).toBe("");
  });
});

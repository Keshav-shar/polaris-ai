import { describe, expect, it } from "vitest";
import { SEARCH } from "../../../../src/config/constants";
import { TransportUnavailableError } from "../../../../src/domain/errors/transport-unavailable.error";
import { createTavilySearch } from "../../../../src/infrastructure/search/tavily.adapter";
import { capText, createWikipediaSearch, stripHtml } from "../../../../src/infrastructure/search/wikipedia.adapter";

// A recorded `generator=search` + `prop=extracts` response (formatversion 2, 2026-10-07, trimmed): pages come
// back UNORDERED with their search rank in `index`, and the intro as plain text. No network in this suite.
const liveShape = {
  batchcomplete: true,
  query: {
    pages: [
      {
        pageid: 66924,
        ns: 0,
        title: "Memory management",
        index: 3,
        extract: "Memory management is a form of resource management applied to computer memory &amp; storage.",
      },
      {
        pageid: 177112,
        ns: 0,
        title: "Memory management unit",
        index: 1,
        extract: "A memory management unit (MMU) is a computer hardware unit that examines all references to memory.",
      },
      {
        pageid: 311193,
        ns: 0,
        title: "Memory paging",
        index: 2,
        extract: "In computer operating systems, memory <b>paging</b> is a memory management scheme.",
      },
      { pageid: 999, ns: 0, title: "A page with no intro", index: 4 },
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
  // C122: one call that searches AND returns each hit's plain-text intro.
  it("builds one generator=search + extracts request carrying the User-Agent Wikipedia asks for", async () => {
    const { impl, calls } = fakeFetch(liveShape);
    await createWikipediaSearch(config, impl).search("Memory management Unix", 5);

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      action: "query",
      format: "json",
      formatversion: "2",
      generator: "search",
      gsrsearch: "Memory management Unix",
      gsrlimit: "5",
      prop: "extracts",
      exintro: "1",
      explaintext: "1",
      exlimit: "max",
    });
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe(config.userAgent);
  });

  it("orders by search rank, not array order, and builds canonical curid URLs", async () => {
    // A page retitled tomorrow keeps a curid URL; citations are stored and read back much later.
    const { impl } = fakeFetch(liveShape);
    const results = await createWikipediaSearch(config, impl).search("memory", 5);
    expect(results.map((r) => r.url)).toEqual([
      "https://en.wikipedia.org/w/index.php?curid=177112",
      "https://en.wikipedia.org/w/index.php?curid=311193",
      "https://en.wikipedia.org/w/index.php?curid=66924",
    ]);
  });

  it("uses the intro extract as the snippet, stripped of markup and with entities decoded", async () => {
    const { impl } = fakeFetch(liveShape);
    const results = await createWikipediaSearch(config, impl).search("memory", 5);
    expect(results[0]!.snippet).toContain("examines all references to memory");
    expect(results[1]!.snippet).not.toMatch(/[<>]/);
    expect(results[2]!.snippet).toContain("memory & storage");
  });

  it("drops a page with no intro text: there is nothing to check a claim against", async () => {
    const { impl } = fakeFetch(liveShape);
    const results = await createWikipediaSearch(config, impl).search("memory", 5);
    expect(results.map((r) => r.title)).not.toContain("A page with no intro");
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
    const { impl } = fakeFetch({ query: { pages: "not an array" } });
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

// C103: search text is untrusted and quoted straight into the writer prompt.
describe("capText", () => {
  it("leaves text within the limit alone and cuts longer text with an ellipsis, inside the limit", () => {
    expect(capText("short", 10)).toBe("short");
    const cut = capText("x".repeat(50), 10);
    expect(cut).toHaveLength(10);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("bounds a provider's snippet and title before they can reach a prompt", async () => {
    const huge = "word ".repeat(2_000);
    const fetchImpl = async () =>
      new Response(JSON.stringify({ query: { pages: [{ pageid: 1, index: 1, title: huge, extract: huge }] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    const [hit] = await createWikipediaSearch({ userAgent: "test" }, fetchImpl).search("q", 1);
    expect(hit!.title.length).toBeLessThanOrEqual(SEARCH.TITLE_MAX_CHARS);
    expect(hit!.snippet.length).toBeLessThanOrEqual(SEARCH.SNIPPET_MAX_CHARS);
  });
});

// C115: a search that never completed is a STALL, released uncounted by the worker - not a failure that spends
// one of the node's receives. The 2026-09-24 losses were mostly `fetch failed` from Wikipedia.
describe("search transport faults", () => {
  const dnsFailure = async (): Promise<Response> => {
    throw new TypeError("fetch failed", { cause: Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" }) });
  };

  it("raises TransportUnavailableError when Wikipedia cannot be reached", async () => {
    const error = await createWikipediaSearch(config, dnsFailure)
      .search("q", 1)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportUnavailableError);
    expect((error as Error).message).toBe("Cannot reach the search provider (wikipedia): ENOTFOUND");
  });

  it("treats our own timeout firing as a stall too", async () => {
    const timedOut = async (): Promise<Response> => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    };
    await expect(createWikipediaSearch(config, timedOut).search("q", 1)).rejects.toBeInstanceOf(
      TransportUnavailableError,
    );
  });

  it("keeps an HTTP error an ordinary error: the provider answered", async () => {
    const { impl } = fakeFetch({}, 503);
    const error = await createWikipediaSearch(config, impl)
      .search("q", 1)
      .catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(TransportUnavailableError);
    expect((error as Error).message).toMatch(/HTTP 503/);
  });

  it("gives a caller that aborted on purpose its own abort back", async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted = async (): Promise<Response> => {
      throw Object.assign(new Error("aborted"), { name: "AbortError", code: "ECANCELED" });
    };
    const error = await createWikipediaSearch(config, aborted)
      .search("q", 1, controller.signal)
      .catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(TransportUnavailableError);
  });

  it("applies the same rule to Tavily, without echoing its key", async () => {
    const error = await createTavilySearch({ apiKey: "tvly-secret" }, dnsFailure)
      .search("q", 1)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportUnavailableError);
    expect((error as Error).message).not.toContain("tvly-secret");
  });
});

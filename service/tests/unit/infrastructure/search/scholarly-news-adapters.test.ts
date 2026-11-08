import { describe, expect, it } from "vitest";
import { SEARCH } from "../../../../src/config/constants";
import { TransportUnavailableError } from "../../../../src/domain/errors/transport-unavailable.error";
import { createCrossrefSearch, jatsToText } from "../../../../src/infrastructure/search/crossref.adapter";
import { createGdeltSearch, sanitizeGdeltQuery } from "../../../../src/infrastructure/search/gdelt.adapter";
import { createIeeeXploreSearch } from "../../../../src/infrastructure/search/ieee-xplore.adapter";
import { createIntervalGate } from "../../../../src/infrastructure/search/interval-gate";
import { abstractFromInvertedIndex, createOpenAlexSearch } from "../../../../src/infrastructure/search/openalex.adapter";

// C146 providers. No network: every fetch is a fake that records the URL and answers a recorded-shape body.
function fakeFetch(answer: { status?: number; body: unknown } | (() => never)) {
  const urls: string[] = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    urls.push(url);
    if (typeof answer === "function") return answer();
    void init;
    const status = answer.status ?? 200;
    const text = typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body);
    return { ok: status >= 200 && status < 300, status, text: async () => text } as Response;
  };
  return { impl, urls };
}

const ua = "polaris-ai/test";
const openGate = { acquire: async () => true };

describe("createCrossrefSearch (Cambridge, Oxford, IEEE)", () => {
  // Shape recorded live 2026-11-08 (member 56, has-abstract), trimmed.
  const body = {
    status: "ok",
    message: {
      items: [
        {
          DOI: "10.1017/cbo9781139168212",
          title: ["Light and Photosynthesis in Aquatic Ecosystems"],
          publisher: "Cambridge University Press",
          abstract: "<jats:title>Abstract</jats:title><jats:p>Beginning systematically with the fundamentals.</jats:p>",
        },
        { DOI: "10.1093/no-abstract", title: ["A title only"] },
        { title: ["No DOI at all"] },
      ],
    },
  };

  it("searches only the configured presses, with abstracts, in the polite pool", async () => {
    const { impl, urls } = fakeFetch({ body });
    await createCrossrefSearch({ userAgent: ua, contactEmail: "dev@example.test" }, impl).search("photosynthesis", 3);
    const url = new URL(urls[0]!);
    expect(url.origin + url.pathname).toBe(SEARCH.CROSSREF_API_URL);
    expect(url.searchParams.get("filter")).toBe("member:56,member:286,member:263,has-abstract:true");
    expect(url.searchParams.get("mailto")).toBe("dev@example.test");
    expect(url.searchParams.get("query.bibliographic")).toBe("photosynthesis");
  });

  it("returns DOI links, publisher-tagged titles and JATS-free abstracts; skips items with no text or no DOI", async () => {
    const results = await createCrossrefSearch({ userAgent: ua }, fakeFetch({ body }).impl).search("photosynthesis", 5);
    expect(results).toEqual([
      {
        url: "https://doi.org/10.1017/cbo9781139168212",
        title: "Light and Photosynthesis in Aquatic Ecosystems (Cambridge University Press)",
        snippet: "Beginning systematically with the fundamentals.",
        provider: "crossref",
      },
    ]);
  });

  it("keeps sentences apart when JATS block tags are stripped", () => {
    expect(jatsToText("<jats:p>One.</jats:p><jats:p>Two.</jats:p>").replace(/\s+/g, " ").trim()).toBe("One. Two.");
  });

  it("raises a network fault as a stall and a status as an ordinary error", async () => {
    const down = fakeFetch(() => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    });
    await expect(createCrossrefSearch({ userAgent: ua }, down.impl).search("q", 2)).rejects.toBeInstanceOf(TransportUnavailableError);
    await expect(createCrossrefSearch({ userAgent: ua }, fakeFetch({ status: 503, body: "" }).impl).search("q", 2)).rejects.toThrow(
      "crossref search failed with HTTP 503",
    );
  });
});

describe("createOpenAlexSearch (the Google Scholar stand-in)", () => {
  it("rebuilds an abstract from its inverted index, in order, bounded", () => {
    expect(abstractFromInvertedIndex({ light: [1], Plants: [0], use: [2] })).toBe("Plants light use");
    expect(abstractFromInvertedIndex({ a: [0], far: [10_000] }, 400)).toBe("a");
    expect(abstractFromInvertedIndex(null)).toBe("");
  });

  it("asks for non-retracted works with abstracts and prefers the DOI link", async () => {
    const { impl, urls } = fakeFetch({
      body: {
        results: [
          { id: "https://openalex.org/W1", doi: "https://doi.org/10.1/x", display_name: "Paper", abstract_inverted_index: { Text: [0] } },
          { id: "https://openalex.org/W2", doi: null, display_name: "No abstract", abstract_inverted_index: null },
          {
            id: "https://openalex.org/W3",
            doi: null,
            display_name: "Landing",
            abstract_inverted_index: { Body: [0] },
            primary_location: { landing_page_url: "https://journal.example/a" },
          },
        ],
      },
    });
    const results = await createOpenAlexSearch({ apiKey: "k", userAgent: ua }, impl).search("photosynthesis", 5);
    expect(new URL(urls[0]!).searchParams.get("filter")).toBe("has_abstract:true,is_retracted:false");
    expect(results.map((r) => [r.url, r.snippet, r.provider])).toEqual([
      ["https://doi.org/10.1/x", "Text", "openalex"],
      ["https://journal.example/a", "Body", "openalex"],
    ]);
  });

  it("never puts the key in an error message", async () => {
    const error = await createOpenAlexSearch({ apiKey: "secret-key-123", userAgent: ua }, fakeFetch({ status: 429, body: "" }).impl)
      .search("q", 2)
      .catch((e: unknown) => e);
    expect(String(error)).not.toContain("secret-key-123");
  });
});

describe("createIeeeXploreSearch", () => {
  const article = { title: "Photonic circuits", abstract: "An abstract.", doi: "10.1109/x" };

  it("maps articles to DOI links", async () => {
    const results = await createIeeeXploreSearch({ apiKey: "k" }, fakeFetch({ body: { articles: [article] } }).impl).search("q", 2);
    expect(results).toEqual([{ url: "https://doi.org/10.1109/x", title: "Photonic circuits", snippet: "An abstract.", provider: "ieee" }]);
  });

  it("opens a circuit for the rest of the UTC day after a quota refusal, then closes it the next day", async () => {
    let today = new Date("2026-11-08T10:00:00Z");
    let status = 403;
    const calls: string[] = [];
    const impl = async (url: string): Promise<Response> => {
      calls.push(url);
      const text = JSON.stringify({ articles: [article] });
      return { ok: status === 200, status, text: async () => text } as Response;
    };
    const search = createIeeeXploreSearch({ apiKey: "k", now: () => today }, impl);
    await expect(search.search("q", 2)).rejects.toThrow("HTTP 403");
    await expect(search.search("q", 2)).rejects.toThrow("skipped until the next UTC day");
    expect(calls).toHaveLength(1);
    today = new Date("2026-11-09T00:00:01Z");
    status = 200;
    expect(await search.search("q", 2)).toHaveLength(1);
  });
});

describe("createGdeltSearch (Reuters, AP)", () => {
  it("sanitizes the topic so it can never change the query's operators or widen the domain filter", () => {
    expect(sanitizeGdeltQuery('Photosynthesis" OR domain:evil.example (x) -y')).toBe("Photosynthesis domain evil example");
    expect(sanitizeGdeltQuery("Light AND NOT dark")).toBe("Light dark");
    expect(sanitizeGdeltQuery("AI")).toBe("");
  });

  it("restricts to the configured news domains and returns headline-only snippets", async () => {
    const { impl, urls } = fakeFetch({
      body: {
        articles: [
          { url: "https://www.reuters.com/a", title: "Crops and heat", domain: "reuters.com", seendate: "20261101T120000Z" },
          { url: "https://apnews.com/b" },
        ],
      },
    });
    const results = await createGdeltSearch({ userAgent: ua, gate: openGate }, impl).search("crop yields", 5);
    expect(new URL(urls[0]!).searchParams.get("query")).toBe("crop yields (domain:reuters.com OR domain:apnews.com)");
    expect(results).toEqual([
      {
        url: "https://www.reuters.com/a",
        title: "Crops and heat",
        snippet: "News headline (reuters.com, 2026-11-01): Crops and heat",
        provider: "gdelt",
      },
    ]);
  });

  it("reads GDELT's plain-text rate-limit refusal as no results, not a crash", async () => {
    const refusal = fakeFetch({ body: "Please limit requests to one every 5 seconds or contact ..." });
    expect(await createGdeltSearch({ userAgent: ua, gate: openGate }, refusal.impl).search("crop yields", 5)).toEqual([]);
  });

  it("skips the provider without calling it when the rate gate is busy", async () => {
    const { impl, urls } = fakeFetch({ body: { articles: [] } });
    const busy = { acquire: async () => false };
    await expect(createGdeltSearch({ userAgent: ua, gate: busy }, impl).search("crop yields", 5)).rejects.toThrow("gate busy");
    expect(urls).toHaveLength(0);
  });
});

describe("createIntervalGate", () => {
  it("spaces callers by the interval, in order, and refuses one whose slot is beyond the max wait", async () => {
    let clock = 0;
    const slept: number[] = [];
    const gate = createIntervalGate({ minIntervalMs: 5_000, maxWaitMs: 10_000, now: () => clock, sleep: async (ms) => void slept.push(ms) });
    expect(await gate.acquire()).toBe(true); // slot 0
    expect(await gate.acquire()).toBe(true); // slot 5 s
    expect(await gate.acquire()).toBe(true); // slot 10 s
    expect(await gate.acquire()).toBe(false); // slot 15 s > 10 s wait: refused, no slot taken
    expect(slept).toEqual([5_000, 10_000]);
    clock = 20_000;
    expect(await gate.acquire()).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { SearchPort, SearchResult } from "../../../../src/application/ports/search.port";
import { TransportUnavailableError } from "../../../../src/domain/errors/transport-unavailable.error";
import type { SourceProvider } from "../../../../src/domain/schemas/evidence.schema";
import {
  createMultiSourceSearch,
  mergeRoundRobin,
  workKey,
} from "../../../../src/infrastructure/search/multi-source-search.adapter";

const r = (provider: SourceProvider, url: string): SearchResult => ({ url, title: url, snippet: "s", provider });
const answering = (results: SearchResult[]): SearchPort => ({ search: async () => results });
const failing = (error: unknown): SearchPort => ({
  search: async () => {
    throw error;
  },
});
function logger() {
  const warnings: { message: string; context: unknown }[] = [];
  return { warnings, warn: (message: string, context?: unknown) => void warnings.push({ message, context }) };
}

describe("workKey", () => {
  it("treats a DOI as one work whichever index returned it", () => {
    expect(workKey("https://doi.org/10.1109/ABC")).toBe(workKey("https://dx.doi.org/10.1109/abc"));
    expect(workKey("https://a.example/x/#frag")).toBe(workKey("https://A.example/x"));
  });
});

describe("mergeRoundRobin (C146)", () => {
  const wiki = [r("wikipedia", "https://w/1"), r("wikipedia", "https://w/2"), r("wikipedia", "https://w/3")];
  const cross = [r("crossref", "https://doi.org/10.1/a"), r("crossref", "https://doi.org/10.1/b"), r("crossref", "https://doi.org/10.1/c")];
  const news = [r("gdelt", "https://reuters.com/n")];

  it("takes every provider's best before anyone's second, capped per provider", () => {
    expect(mergeRoundRobin([wiki, cross, news], 5, 2).map((x) => x.url)).toEqual([
      "https://w/1",
      "https://doi.org/10.1/a",
      "https://reuters.com/n",
      "https://w/2",
      "https://doi.org/10.1/b",
    ]);
  });

  it("fills free slots with the overflow only when the other providers ran dry", () => {
    expect(mergeRoundRobin([wiki], 3, 2).map((x) => x.url)).toEqual(["https://w/1", "https://w/2", "https://w/3"]);
  });

  it("drops the same work found by two providers", () => {
    const openalex = [r("openalex", "https://doi.org/10.1/A")];
    expect(mergeRoundRobin([cross, openalex], 8, 2).filter((x) => workKey(x.url) === "doi:10.1/a")).toHaveLength(1);
  });
});

describe("createMultiSourceSearch", () => {
  it("searches every provider and logs, without failing on, one that errors", async () => {
    const log = logger();
    const search = createMultiSourceSearch({
      providers: [
        { provider: "wikipedia", port: answering([r("wikipedia", "https://w/1")]) },
        { provider: "crossref", port: failing(new Error("crossref search failed with HTTP 500")) },
      ],
      logger: log,
    });
    expect((await search.search("q", 8)).map((x) => x.url)).toEqual(["https://w/1"]);
    expect(log.warnings).toEqual([
      { message: "search provider skipped", context: { provider: "crossref", reason: "crossref search failed with HTTP 500" } },
    ]);
  });

  it("is a STALL when nothing came back and a provider could not be reached (retried uncounted, C94)", async () => {
    const search = createMultiSourceSearch({
      providers: [
        { provider: "wikipedia", port: failing(new TransportUnavailableError("the search provider (wikipedia)", "ECONNRESET")) },
        { provider: "gdelt", port: answering([]) },
      ],
      logger: logger(),
    });
    await expect(search.search("q", 8)).rejects.toBeInstanceOf(TransportUnavailableError);
  });

  it("is an ordinary failure when every provider answered with an error", async () => {
    const search = createMultiSourceSearch({
      providers: [
        { provider: "wikipedia", port: failing(new Error("HTTP 500")) },
        { provider: "crossref", port: failing(new Error("HTTP 502")) },
      ],
      logger: logger(),
    });
    await expect(search.search("q", 8)).rejects.toThrow("every search provider failed: wikipedia, crossref");
  });

  it("returns an empty set, not an error, when every provider answered with nothing", async () => {
    const search = createMultiSourceSearch({ providers: [{ provider: "wikipedia", port: answering([]) }], logger: logger() });
    expect(await search.search("q", 8)).toEqual([]);
  });
});

import type { SearchPort, SearchResult } from "../../application/ports/search.port";
import { SEARCH } from "../../config/constants";

export type CachedSearchConfig = {
  maxEntries?: number;
  ttlMs?: number;
  // Injected so expiry is testable without waiting; the clock is a dependency, never ambient in a test.
  now?: () => number;
};

type Entry = { results: SearchResult[]; expiresAt: number };

// A bounded cache in front of any SearchPort (C126). An article message that is redelivered - a 429 on the
// writer, a network stall - searches for exactly the same query again; this answers it without a second
// call to the provider. Bounded by COUNT (least-recently-used out first) and by AGE, so a long-lived API
// process cannot grow it without limit. Failures are never cached: the next attempt must really retry.
// Process-level, so in a Lambda it lives per warm container - which is exactly where redeliveries land.
export function createCachedSearch(inner: SearchPort, config: CachedSearchConfig = {}): SearchPort {
  const maxEntries = config.maxEntries ?? SEARCH.CACHE_MAX_ENTRIES;
  const ttlMs = config.ttlMs ?? SEARCH.CACHE_TTL_MS;
  const now = config.now ?? Date.now;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError(`maxEntries must be a positive integer, got ${maxEntries}`);
  }
  // A Map iterates in insertion order, so re-inserting on every hit makes the first key the least recently used.
  const entries = new Map<string, Entry>();

  // Copies on the way in and out: a caller must not be able to edit what the next caller is served.
  const copy = (results: readonly SearchResult[]): SearchResult[] => results.map((result) => ({ ...result }));

  return {
    async search(query, maxResults, signal) {
      const key = `${maxResults}\u0000${query}`;
      const hit = entries.get(key);
      if (hit !== undefined) {
        entries.delete(key);
        if (hit.expiresAt > now()) {
          entries.set(key, hit);
          return copy(hit.results);
        }
      }
      const results = await inner.search(query, maxResults, signal);
      entries.set(key, { results: copy(results), expiresAt: now() + ttlMs });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      return copy(results);
    },
  };
}

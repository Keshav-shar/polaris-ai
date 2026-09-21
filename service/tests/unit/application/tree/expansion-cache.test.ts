import { describe, expect, it } from "vitest";
import {
  createExpansionCacheDep,
  expansionCacheKey,
  type ExpansionCacheKeyParts,
} from "../../../../src/application/tree/expansion-cache";
import { createMemoryExpansionCache } from "../../../../src/infrastructure/memory/memory-expansion-cache.store";

const base: ExpansionCacheKeyParts = {
  model: "gemini-3.6-flash",
  position: "normal",
  topic: "photosynthesis",
  ancestorTopics: ["biology", "plant cells"],
};

describe("expansionCacheKey", () => {
  it("is stable for the same request", () => {
    expect(expansionCacheKey(base)).toBe(expansionCacheKey({ ...base }));
  });

  it("ignores case and surrounding whitespace in topics", () => {
    expect(expansionCacheKey({ ...base, topic: "  PhotoSynthesis " })).toBe(expansionCacheKey(base));
    expect(expansionCacheKey({ ...base, ancestorTopics: ["Biology", " PLANT   cells "] })).toBe(
      expansionCacheKey(base),
    );
  });

  it("changes with the model, so switching provider profile namespaces the cache", () => {
    expect(expansionCacheKey({ ...base, model: "llama-3.3-70b" })).not.toBe(expansionCacheKey(base));
  });

  it("changes with the layer position and the ancestor trail", () => {
    expect(expansionCacheKey({ ...base, position: "taper" })).not.toBe(expansionCacheKey(base));
    expect(expansionCacheKey({ ...base, ancestorTopics: ["plant cells", "biology"] })).not.toBe(
      expansionCacheKey(base),
    );
    expect(expansionCacheKey({ ...base, ancestorTopics: [] })).not.toBe(expansionCacheKey(base));
  });

  it("cannot be forged by moving a separator into a component", () => {
    // Without a separator that cannot appear in a topic, these two would collide.
    expect(expansionCacheKey({ ...base, topic: "a", ancestorTopics: ["b"] })).not.toBe(
      expansionCacheKey({ ...base, topic: "a b", ancestorTopics: [] }),
    );
  });
});

describe("createExpansionCacheDep", () => {
  it("follows a model that changes mid-run, so a failover starts a new namespace", () => {
    // A fixed string would keep filing the fallback provider's answers under the exhausted provider's
    // key, mixing two models' children in one tree (docs/conflicts.md C59).
    let model = "gemini";
    const dep = createExpansionCacheDep({ cache: createMemoryExpansionCache(), model: () => model });
    const context = { depth: 1, maxDepth: 3, position: "normal" as const, ancestors: [] };
    const request = { topic: "Photosynthesis", context };
    const before = dep.keyFor(request);
    model = "groq";
    expect(dep.keyFor(request)).not.toBe(before);
  });

  it("keys on the context's position and ancestor topics, not their briefs", () => {
    const dep = createExpansionCacheDep({ cache: createMemoryExpansionCache(), model: "m" });
    const context = { depth: 1, maxDepth: 3, position: "normal" as const, ancestors: [{ depth: 0, topic: "biology", brief: "one brief" }] };
    const other = { ...context, ancestors: [{ depth: 0, topic: "biology", brief: "a totally different brief" }] };
    expect(dep.keyFor({ topic: "t", context })).toBe(dep.keyFor({ topic: "t", context: other }));
  });

  it("round-trips an output through the store", async () => {
    const dep = createExpansionCacheDep({ cache: createMemoryExpansionCache(), model: "m" });
    const output = { brief: "b", children: ["one", "two"] };
    await dep.put("k", output);
    expect(await dep.get("k")).toEqual(output);
    expect(await dep.get("missing")).toBeUndefined();
  });

  it("hands back a copy, so a caller cannot mutate a stored entry", async () => {
    const cache = createMemoryExpansionCache();
    await cache.put("k", { brief: "b", children: ["one"] });
    const first = await cache.get("k");
    first?.children.push("injected");
    expect((await cache.get("k"))?.children).toEqual(["one"]);
  });
});

import { describe, expect, it } from "vitest";
import { verifyExpansion } from "../../../../src/application/agents/verifier.agent";
import { createNodeConstructor } from "../../../../src/application/tree/construct-node";
import { seedFor } from "../../../../src/application/tree/seed";
import { createExpansionCacheDep } from "../../../../src/application/tree/expansion-cache";
import { EXPAND } from "../../../../src/config/constants";
import { createMemoryExpansionCache } from "../../../../src/infrastructure/memory/memory-expansion-cache.store";
import type { ExpandOutput, NodeContext } from "../../../../src/domain/schemas/node.schema";
import { fakeLogger } from "../../../fixtures/fake-generate";

const context: NodeContext = { depth: 0, maxDepth: 2, position: "normal", ancestors: [] };
const topics = (n: number) => Array.from({ length: n }, (_, i) => `Topic ${i + 1}`);

function setup(output: ExpandOutput, consolidate: (children: readonly string[]) => Promise<string[]>) {
  const { logger, warnings } = fakeLogger();
  let consolidateCalls = 0;
  const constructor = createNodeConstructor({
    expand: async () => output,
    verify: verifyExpansion,
    consolidate: async ({ children }) => {
      consolidateCalls++;
      return consolidate(children);
    },
    logger,
  });
  return { constructor, warnings, calls: () => consolidateCalls };
}

describe("createNodeConstructor", () => {
  it("does not consolidate at or under the cap", async () => {
    const { constructor, calls } = setup({ brief: "b", children: topics(EXPAND.MAX_CHILDREN) }, async () => []);
    const out = await constructor.construct({ topic: "Root", context });
    expect(out.children).toHaveLength(EXPAND.MAX_CHILDREN);
    expect(calls()).toBe(0);
  });

  it("consolidates once when over the cap", async () => {
    const { constructor, calls } = setup({ brief: "b", children: topics(20) }, async (c) => c.slice(0, 8));
    const out = await constructor.construct({ topic: "Root", context });
    expect(calls()).toBe(1);
    expect(out.children).toEqual(topics(8));
  });

  it("counts the cap after dedupe, so duplicates alone never trigger consolidation", async () => {
    const children = [...topics(10), ...topics(10).map((t) => t.toUpperCase())];
    const { constructor, calls } = setup({ brief: "b", children }, async () => []);
    expect((await constructor.construct({ topic: "Root", context })).children).toHaveLength(10);
    expect(calls()).toBe(0);
  });

  it("falls back to the first MAX_CHILDREN children and warns when the consolidator fails", async () => {
    const { constructor, warnings } = setup({ brief: "b", children: topics(20) }, () =>
      Promise.reject(new Error("LLM down")),
    );
    const out = await constructor.construct({ topic: "Root", context });
    expect(out.children).toEqual(topics(EXPAND.MAX_CHILDREN));
    expect(warnings.map((w) => w.msg)).toEqual(["consolidator fallback"]);
  });

  it("returns [] at the leaf without consolidating, and logs the stripped children", async () => {
    const { constructor, calls, warnings } = setup({ brief: "b", children: topics(20) }, async () => []);
    const out = await constructor.construct({ topic: "Root", context: { ...context, depth: 2, position: "leaf" } });
    expect(out.children).toEqual([]);
    expect(calls()).toBe(0);
    expect(warnings.map((w) => w.msg)).toEqual(["leaf rule stripped children"]);
  });

  it("derives one seed from seedKey for both LLM calls, and none without a key", async () => {
    const seeds: (number | undefined)[] = [];
    const constructor = createNodeConstructor({
      expand: async ({ seed }) => {
        seeds.push(seed);
        return { brief: "b", children: topics(20) };
      },
      verify: verifyExpansion,
      consolidate: async ({ children, seed }) => {
        seeds.push(seed);
        return children.slice(0, 3);
      },
      logger: fakeLogger().logger,
    });
    await constructor.construct({ topic: "Root", context, seedKey: "node-1" });
    await constructor.construct({ topic: "Root", context });
    expect(seeds[0]).toBe(seedFor("node-1"));
    expect(seeds[1]).toBe(seedFor("node-1"));
    expect(seeds.slice(2)).toEqual([undefined, undefined]);
  });

  it("re-verifies consolidated children (cycle guard, cap)", async () => {
    const { constructor } = setup({ brief: "b", children: topics(20) }, async () => ["Root", ...topics(20)]);
    const out = await constructor.construct({ topic: "Root", context });
    expect(out.children).not.toContain("Root");
    expect(out.children.length).toBeLessThanOrEqual(EXPAND.MAX_CHILDREN);
  });

  describe("expansion cache", () => {
    const cached = (cache = createExpansionCacheDep({ cache: createMemoryExpansionCache(), namespace: "m" })) => {
      let expandCalls = 0;
      let consolidateCalls = 0;
      const constructor = createNodeConstructor({
        expand: async () => {
          expandCalls++;
          return { brief: "b", children: topics(22) };
        },
        verify: verifyExpansion,
        consolidate: async ({ children }) => {
          consolidateCalls++;
          return children.slice(0, 8);
        },
        logger: fakeLogger().logger,
        cache,
      });
      return {
        constructor,
        get expandCalls() {
          return expandCalls;
        },
        get consolidateCalls() {
          return consolidateCalls;
        },
      };
    };

    it("serves a second identical request without calling the LLM at all", async () => {
      const dep = createExpansionCacheDep({ cache: createMemoryExpansionCache(), namespace: "m" });
      const first = cached(dep);
      const a = await first.constructor.construct({ topic: "Root", context });
      const second = cached(dep);
      const b = await second.constructor.construct({ topic: "Root", context });
      // A hit skips the expander AND the consolidator: the whole node costs nothing.
      expect(second.expandCalls).toBe(0);
      expect(second.consolidateCalls).toBe(0);
      expect(b).toEqual(a);
    });

    it("stores the post-consolidation output, so cached children are the trimmed set", async () => {
      const cache = createMemoryExpansionCache();
      const dep = createExpansionCacheDep({ cache, namespace: "m" });
      const out = await cached(dep).constructor.construct({ topic: "Root", context });
      expect(out.children).toHaveLength(8);
      // Identical children across runs is what keeps derived child ids stable (idempotency rule 4).
      const key = dep.keyFor({ topic: "Root", context });
      expect((await cache.get(key))?.children).toEqual(out.children);
    });

    it("misses when the namespace differs, rather than serving another provider's answer", async () => {
      const cache = createMemoryExpansionCache();
      await cached(createExpansionCacheDep({ cache, namespace: "m" })).constructor.construct({ topic: "Root", context });
      const other = cached(createExpansionCacheDep({ cache, namespace: "other-model" }));
      await other.constructor.construct({ topic: "Root", context });
      expect(other.expandCalls).toBe(1);
    });

    // The regression that justifies splitting cacheNamespace() from activeModel(). A node that fails and
    // is redelivered by the queue may be served by a DIFFERENT pool member the second time. Keyed on the
    // answering model, the retry would miss and pay for a whole second expansion; worse, construct-node
    // derives the key BEFORE the call and writes with it AFTER, so one member's answer would be filed
    // under another's key. A pool namespace is constant, so the retry hits.
    it("still hits the cache when a redelivered node is answered by a different pool member", async () => {
      const cache = createMemoryExpansionCache();
      // Rotates between calls, exactly as a pool's activeModel() does.
      let answeringModel = "member-a";
      const byPool = createExpansionCacheDep({ cache, namespace: () => "pool:0123456789abcdef" });
      const byAnsweringModel = createExpansionCacheDep({ cache, namespace: () => answeringModel });

      const keyBefore = byPool.keyFor({ topic: "Root", context });
      const wrongKeyBefore = byAnsweringModel.keyFor({ topic: "Root", context });
      const first = cached(byPool);
      const a = await first.constructor.construct({ topic: "Root", context });

      answeringModel = "member-b";

      // Keyed on whoever answered, the retry would look under a different key and pay again...
      expect(byAnsweringModel.keyFor({ topic: "Root", context })).not.toBe(wrongKeyBefore);
      // ...while the pool namespace is stable, so the redelivery hits.
      expect(byPool.keyFor({ topic: "Root", context })).toBe(keyBefore);

      const retry = cached(byPool);
      const b = await retry.constructor.construct({ topic: "Root", context });
      expect(retry.expandCalls).toBe(0);
      expect(b).toEqual(a);
    });

    it("warns but still returns the node when the cache write fails", async () => {
      const { logger, warnings } = fakeLogger();
      const constructor = createNodeConstructor({
        expand: async () => ({ brief: "b", children: topics(2) }),
        verify: verifyExpansion,
        consolidate: async ({ children }) => [...children],
        logger,
        cache: {
          keyFor: () => "k",
          get: async () => undefined,
          put: async () => {
            throw new Error("cache is down");
          },
        },
      });
      const out = await constructor.construct({ topic: "Root", context });
      expect(out.children).toHaveLength(2);
      expect(warnings.map((w) => w.msg)).toContain("expansion cache put failed");
    });
  });
});

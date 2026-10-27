import { describe, expect, it } from "vitest";
import { verifyExpansion } from "../../../../src/application/agents/verifier.agent";
import { createNodeConstructor } from "../../../../src/application/tree/construct-node";
import { seedFor } from "../../../../src/application/tree/seed";
import { createExpansionCacheDep } from "../../../../src/application/tree/expansion-cache";
import { EXPAND } from "../../../../src/config/constants";
import { createMemoryExpansionCache } from "../../../../src/infrastructure/memory/memory-expansion-cache.store";
import type { NodeContext, RawExpansion } from "../../../../src/domain/schemas/node.schema";
import { fakeLogger } from "../../../fixtures/fake-generate";

const context: NodeContext = { depth: 1, maxDepth: 3, position: "normal", ancestors: [] };
const drafts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ topic: `Topic ${i + 1}`, brief: `What topic ${i + 1} covers.` }));

function setup(output: RawExpansion) {
  const { logger, warnings } = fakeLogger();
  let expandCalls = 0;
  const constructor = createNodeConstructor({
    expand: async () => {
      expandCalls++;
      return output;
    },
    verify: verifyExpansion,
    logger,
  });
  return { constructor, warnings, calls: () => expandCalls };
}

describe("createNodeConstructor", () => {
  it("makes exactly one expand call and returns each child with its brief", async () => {
    const { constructor, calls } = setup({ children: drafts(3) });
    const out = await constructor.construct({ topic: "Root", brief: "Root brief.", context });
    expect(calls()).toBe(1);
    expect(out).toEqual({ children: drafts(3) });
  });

  // C101: there is no consolidator any more, so an over-long list costs no second call - it is cut in the
  // model's teaching order, keeping the most fundamental subtopics.
  it("trims over EXPAND.MAX_CHILDREN in teaching order, with no second call", async () => {
    const { constructor, calls, warnings } = setup({ children: drafts(EXPAND.MAX_CHILDREN + 5) });
    const out = await constructor.construct({ topic: "Root", context });
    expect(calls()).toBe(1);
    expect(out.children).toEqual(drafts(EXPAND.MAX_CHILDREN));
    expect(warnings.map((w) => w.msg)).toEqual(["children over the cap trimmed"]);
  });

  it("drops a child with an invalid brief and logs it, rather than spending a repair call", async () => {
    const children = [...drafts(2), { topic: "Bad", brief: "word ".repeat(60) }];
    const { constructor, calls, warnings } = setup({ children });
    const out = await constructor.construct({ topic: "Root", context });
    expect(calls()).toBe(1);
    expect(out.children).toEqual(drafts(2));
    expect(warnings.map((w) => w.msg)).toEqual(["invalid children dropped"]);
  });

  it("names the topic and writes the brief on the root call", async () => {
    const { constructor } = setup({ topic: "Photosynthesis", brief: "How plants make sugar.", children: drafts(2) });
    const out = await constructor.construct({
      topic: "teach me photosynthesis",
      request: "teach me photosynthesis",
      context: { ...context, depth: 0 },
    });
    expect(out).toEqual({ topic: "Photosynthesis", brief: "How plants make sugar.", children: drafts(2) });
  });

  it("derives the seed from seedKey, and none without a key", async () => {
    const seeds: (number | undefined)[] = [];
    const constructor = createNodeConstructor({
      expand: async ({ seed }) => {
        seeds.push(seed);
        return { children: drafts(2) };
      },
      verify: verifyExpansion,
      logger: fakeLogger().logger,
    });
    await constructor.construct({ topic: "Root", context, seedKey: "node-1" });
    await constructor.construct({ topic: "Root", context });
    expect(seeds).toEqual([seedFor("node-1"), undefined]);
  });

  describe("expansion cache", () => {
    const cached = (cache = createExpansionCacheDep({ cache: createMemoryExpansionCache(), namespace: "m" })) => {
      let expandCalls = 0;
      const constructor = createNodeConstructor({
        expand: async () => {
          expandCalls++;
          return { children: drafts(EXPAND.MAX_CHILDREN + 7) };
        },
        verify: verifyExpansion,
        logger: fakeLogger().logger,
        cache,
      });
      return {
        constructor,
        get expandCalls() {
          return expandCalls;
        },
      };
    };

    it("serves a second identical request without calling the LLM at all", async () => {
      const dep = createExpansionCacheDep({ cache: createMemoryExpansionCache(), namespace: "m" });
      const first = cached(dep);
      const a = await first.constructor.construct({ topic: "Root", context });
      const second = cached(dep);
      const b = await second.constructor.construct({ topic: "Root", context });
      expect(second.expandCalls).toBe(0);
      expect(b).toEqual(a);
    });

    it("stores the trimmed output, briefs included, so cached children are the kept set", async () => {
      const cache = createMemoryExpansionCache();
      const dep = createExpansionCacheDep({ cache, namespace: "m" });
      const out = await cached(dep).constructor.construct({ topic: "Root", context });
      expect(out.children).toHaveLength(EXPAND.MAX_CHILDREN);
      // Identical children across runs is what keeps derived child ids stable (idempotency rule 4).
      const key = dep.keyFor({ topic: "Root", context });
      expect((await cache.get(key))?.children).toEqual(out.children);
    });

    // Two requests that share their first TOPIC_MAX_CHARS characters share a provisional topic; keyed on that,
    // the second learner would be served the first one's tree.
    it("keys the root on the whole request, not the provisional topic cut from it", async () => {
      const dep = createExpansionCacheDep({ cache: createMemoryExpansionCache(), namespace: "m" });
      const root = { ...context, depth: 0 };
      const build = () =>
        createNodeConstructor({
          expand: async ({ request }) => ({ topic: request ?? "x", brief: "b", children: drafts(1) }),
          verify: verifyExpansion,
          logger: fakeLogger().logger,
          cache: dep,
        });
      const a = await build().construct({ topic: "same prefix", request: "same prefix: cats", context: root });
      const b = await build().construct({ topic: "same prefix", request: "same prefix: dogs", context: root });
      expect(a.topic).toBe("same prefix: cats");
      expect(b.topic).toBe("same prefix: dogs");
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
      let answeringModel = "member-a";
      const byPool = createExpansionCacheDep({ cache, namespace: () => "pool:0123456789abcdef" });
      const byAnsweringModel = createExpansionCacheDep({ cache, namespace: () => answeringModel });

      const keyBefore = byPool.keyFor({ topic: "Root", context });
      const wrongKeyBefore = byAnsweringModel.keyFor({ topic: "Root", context });
      const a = await cached(byPool).constructor.construct({ topic: "Root", context });

      answeringModel = "member-b";

      expect(byAnsweringModel.keyFor({ topic: "Root", context })).not.toBe(wrongKeyBefore);
      expect(byPool.keyFor({ topic: "Root", context })).toBe(keyBefore);

      const retry = cached(byPool);
      const b = await retry.constructor.construct({ topic: "Root", context });
      expect(retry.expandCalls).toBe(0);
      expect(b).toEqual(a);
    });

    it("warns but still returns the node when the cache write fails", async () => {
      const { logger, warnings } = fakeLogger();
      const constructor = createNodeConstructor({
        expand: async () => ({ children: drafts(2) }),
        verify: verifyExpansion,
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

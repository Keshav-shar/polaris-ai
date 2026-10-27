import { EXPAND } from "../../config/constants";
import type { AncestorRef, Expansion, NodeContext, RawExpansion } from "../../domain/schemas/node.schema";
import type { Logger } from "../../shared/logger";
import { seedFor } from "./seed";

// Structural so this module never imports agents; composition passes createExpandAgent(...).expand and
// verifyExpansion.
export type NodeConstructorDeps = {
  expand(request: {
    topic: string;
    brief?: string | undefined;
    request?: string | undefined;
    context: NodeContext;
    seed?: number | undefined;
  }): Promise<RawExpansion>;
  verify(request: { output: RawExpansion; topic: string; ancestors: readonly AncestorRef[]; isRoot: boolean }): {
    output: Expansion;
    droppedChildren: number;
  };
  logger: Pick<Logger, "warn">;
  cache?: ExpansionCacheDep;
};

// Optional: when absent, construct() behaves exactly as before. Structural, so this module still imports
// no agent and no port. application/tree/expansion-cache.ts builds it from ExpansionCachePort.
export type ExpansionCacheDep = {
  keyFor(request: { topic: string; context: NodeContext }): string;
  get(key: string): Promise<Expansion | undefined>;
  put(key: string, output: Expansion): Promise<void>;
};

// seedKey (the node id) gives the call a stable seed; it only takes effect when LLM_SEED_MODE=node.
// `request` marks the root: the learner's raw text, which the root call reads to name the topic (C100).
// `brief` is the node's own brief as its parent wrote it (C99), passed so the model can scope the children.
export type ConstructRequest = {
  topic: string;
  brief?: string | undefined;
  request?: string | undefined;
  context: NodeContext;
  seedKey?: string;
};

export type NodeConstructor = {
  construct(request: ConstructRequest): Promise<Expansion>;
};

// expand → verify → cut to EXPAND.MAX_CHILDREN in teaching order. Exactly ONE LLM request on the happy path:
// the consolidator that used to merge an over-long list is gone, because a merged topic would have no brief
// and the balanced branch cap binds well below this ceiling anyway (docs/conflicts.md C101). The caller stores
// the result, so a retry never re-runs this; a cache hit skips the call.
export function createNodeConstructor({ expand, verify, logger, cache }: NodeConstructorDeps): NodeConstructor {
  // Stores the FINAL output, so a hit yields byte-identical children - and therefore identical child node
  // ids - across runs (docs/conflicts.md C47).
  const remember = async (key: string | undefined, output: Expansion): Promise<Expansion> => {
    if (key === undefined || cache === undefined) return output;
    try {
      await cache.put(key, output);
    } catch (error) {
      // Never fail a node over the cache: it is an optimisation, not a source of truth.
      logger.warn("expansion cache put failed", { error });
    }
    return output;
  };

  return {
    async construct({ topic, brief, request, context, seedKey }) {
      // The root is keyed on the learner's whole request, not the provisional topic cut from it: two
      // requests sharing a prefix must not share a tree.
      const key = cache?.keyFor({ topic: request ?? topic, context });
      if (key !== undefined && cache !== undefined) {
        const hit = await cache.get(key);
        if (hit) return hit;
      }
      const seed = seedKey === undefined ? undefined : seedFor(seedKey);
      const raw = await expand({ topic, brief, request, context, seed });
      const { output, droppedChildren } = verify({
        output: raw,
        topic,
        ancestors: context.ancestors,
        isRoot: request !== undefined,
      });
      if (droppedChildren > 0) logger.warn("invalid children dropped", { topic, dropped: droppedChildren });
      if (output.children.length > EXPAND.MAX_CHILDREN) {
        logger.warn("children over the cap trimmed", { topic, children: output.children.length });
      }
      return remember(key, { ...output, children: output.children.slice(0, EXPAND.MAX_CHILDREN) });
    },
  };
}

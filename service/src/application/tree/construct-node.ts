import { EXPAND } from "../../config/constants";
import type { AncestorRef, ExpandOutput, LayerPosition, NodeContext } from "../../domain/schemas/node.schema";
import type { Logger } from "../../shared/logger";
import { seedFor } from "./seed";

// Structural so this module never imports agents; composition passes createExpandAgent(...).expand,
// verifyExpansion and createConsolidatorAgent(...).consolidate.
export type NodeConstructorDeps = {
  expand(request: { topic: string; context: NodeContext; seed?: number }): Promise<ExpandOutput>;
  verify(request: { output: ExpandOutput; topic: string; ancestors: readonly AncestorRef[]; position: LayerPosition }): {
    output: ExpandOutput;
    strippedLeafChildren: number;
  };
  consolidate(request: {
    topic: string;
    ancestors: readonly AncestorRef[];
    children: readonly string[];
    seed?: number;
  }): Promise<string[]>;
  logger: Pick<Logger, "warn">;
  cache?: ExpansionCacheDep;
};

// Optional: when absent, construct() behaves exactly as before. Structural, so this module still imports
// no agent and no port. application/tree/expansion-cache.ts builds it from ExpansionCachePort.
export type ExpansionCacheDep = {
  keyFor(request: { topic: string; context: NodeContext }): string;
  get(key: string): Promise<ExpandOutput | undefined>;
  put(key: string, output: ExpandOutput): Promise<void>;
};

// seedKey (the node id) gives both LLM calls a stable seed; it only takes effect when LLM_SEED_MODE=node.
export type ConstructRequest = { topic: string; context: NodeContext; seedKey?: string };

export type NodeConstructor = {
  construct(request: ConstructRequest): Promise<ExpandOutput>;
};

// expand → verify → (only over the cap) consolidate → verify. The caller stores the result, so a retry never
// re-runs this. A cache hit skips the whole flow, expander and consolidator both.
export function createNodeConstructor({
  expand,
  verify,
  consolidate,
  logger,
  cache,
}: NodeConstructorDeps): NodeConstructor {
  // Stores the FINAL, post-consolidation output, so a hit yields byte-identical children - and therefore
  // identical child node ids - across runs (docs/conflicts.md C47).
  const remember = async (key: string | undefined, output: ExpandOutput): Promise<ExpandOutput> => {
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
    async construct({ topic, context, seedKey }) {
      const { ancestors, position } = context;
      const key = cache?.keyFor({ topic, context });
      if (key !== undefined && cache !== undefined) {
        const hit = await cache.get(key);
        if (hit) return hit;
      }
      const seed = seedKey === undefined ? undefined : seedFor(seedKey);
      const verified = verify({ output: await expand({ topic, context, seed }), topic, ancestors, position });
      if (verified.strippedLeafChildren > 0) {
        logger.warn("leaf rule stripped children", { topic, stripped: verified.strippedLeafChildren });
      }

      const { brief, children } = verified.output;
      if (children.length <= EXPAND.MAX_CHILDREN) return remember(key, verified.output);

      let kept: string[];
      try {
        kept = await consolidate({ topic, ancestors, children, seed });
      } catch (error) {
        // Over the cap is never worth failing a node: keep the model's first (most important) children.
        logger.warn("consolidator fallback", { topic, children: children.length, error });
        kept = children.slice(0, EXPAND.MAX_CHILDREN);
      }
      return remember(
        key,
        verify({ output: { brief, children: kept.slice(0, EXPAND.MAX_CHILDREN) }, topic, ancestors, position })
          .output,
      );
    },
  };
}

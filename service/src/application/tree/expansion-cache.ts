import { PROMPT_VERSION } from "../../config/constants";
import type { ExpandOutput, LayerPosition, NodeContext } from "../../domain/schemas/node.schema";
import { normalizeTopic } from "../../domain/traversal/node-id";
import { sha256Hex } from "../../shared/ids";
import type { ExpansionCachePort } from "../ports/expansion-cache.port";
import type { ExpansionCacheDep } from "./construct-node";

export type ExpansionCacheKeyParts = {
  model: string;
  position: LayerPosition;
  topic: string;
  ancestorTopics: readonly string[];
};

// Ancestor BRIEFS are deliberately excluded (the plan keys on ancestor topics): briefs vary run to run, so
// including them would miss almost always and defeat the cache. Reusing normalizeTopic means two branches
// that dedup to one topic also cache to one key.
const UNIT = "\u001f";
const SEP = "\u0000";

export function expansionCacheKey(parts: ExpansionCacheKeyParts): string {
  const ancestors = parts.ancestorTopics.map(normalizeTopic).join(UNIT);
  return sha256Hex(
    [PROMPT_VERSION, parts.model, parts.position, normalizeTopic(parts.topic), ancestors].join(SEP),
  );
}

// Bundles key derivation with the store so construct-node never learns about PROMPT_VERSION or the model.
// The model is part of the key, so switching provider profile is an automatic namespace change: the new
// provider starts cold and entries written under the old model stay valid if you switch back.
// `model` accepts a getter because a failover switches providers MID-RUN: a fixed string would keep
// filing the fallback's answers under the exhausted provider's namespace (docs/conflicts.md C59).
export function createExpansionCacheDep(deps: {
  cache: ExpansionCachePort;
  model: string | (() => string);
}): ExpansionCacheDep {
  const { model } = deps;
  const modelNow = typeof model === "function" ? model : () => model;
  return {
    keyFor: ({ topic, context }: { topic: string; context: NodeContext }) =>
      expansionCacheKey({
        model: modelNow(),
        position: context.position,
        topic,
        ancestorTopics: context.ancestors.map((a) => a.topic),
      }),
    get: (key: string): Promise<ExpandOutput | undefined> => deps.cache.get(key),
    put: (key: string, output: ExpandOutput): Promise<void> => deps.cache.put(key, output),
  };
}

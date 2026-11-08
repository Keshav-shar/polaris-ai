import { PROMPT_VERSION } from "../../config/constants";
import type { LearnerProfile } from "../../domain/schemas/insight.schema";
import type { Expansion, LayerPosition, NodeContext } from "../../domain/schemas/node.schema";
import { normalizeTopic } from "../../domain/traversal/node-id";
import { sha256Hex } from "../../shared/ids";
import type { ExpansionCachePort } from "../ports/expansion-cache.port";
import type { ExpansionCacheDep } from "./construct-node";

export type ExpansionCacheKeyParts = {
  // Identifies the SET of models whose answers may be filed here, NOT the one that answered. Under a
  // rotating pool the answering model changes per call while this stays constant; see
  // infrastructure/llm/switchable.ts for why keying on the answering model would file answers wrongly.
  namespace: string;
  position: LayerPosition;
  topic: string;
  ancestorTopics: readonly string[];
  // learnerFingerprint() of the profile the call was shaped by (root only, C139). Without it one learner's cached
  // root would be served to another whose profile asks for a different pitch.
  learner?: string | undefined;
};

// A canonical spelling of the profile: same profile, same string, whatever order the preferences came in.
export function learnerFingerprint(profile: LearnerProfile): string {
  return [profile.level, [...profile.preferences].sort().join(","), profile.guidance].join(UNIT);
}

// Ancestor BRIEFS are deliberately excluded (the plan keys on ancestor topics): briefs vary run to run, so
// including them would miss almost always and defeat the cache. Reusing normalizeTopic means two branches
// that dedup to one topic also cache to one key.
const UNIT = "\u001f";
const SEP = "\u0000";

export function expansionCacheKey(parts: ExpansionCacheKeyParts): string {
  const ancestors = parts.ancestorTopics.map(normalizeTopic).join(UNIT);
  const key = [PROMPT_VERSION, parts.namespace, parts.position, normalizeTopic(parts.topic), ancestors];
  // Appended only when present, so every profile-less key is the same as it would be without this field.
  if (parts.learner !== undefined) key.push(parts.learner);
  return sha256Hex(key.join(SEP));
}

// Bundles key derivation with the store so construct-node never learns about PROMPT_VERSION or the
// namespace. Switching provider PROFILE is an automatic namespace change: the new provider starts cold and
// entries written under the old one stay valid if you switch back (docs/conflicts.md C59, C93).
// `namespace` accepts a getter because the answering model can change MID-RUN: a fixed string would keep
// filing the fallback's answers under the exhausted provider's namespace.
// It must NOT be the answering model under a rotating pool: construct-node derives the key BEFORE the call
// and writes with it AFTER, so a per-call model would file one member's answer under another's key.
export function createExpansionCacheDep(deps: {
  cache: ExpansionCachePort;
  namespace: string | (() => string);
}): ExpansionCacheDep {
  const { namespace } = deps;
  const namespaceNow = typeof namespace === "function" ? namespace : () => namespace;
  return {
    keyFor: ({ topic, context }: { topic: string; context: NodeContext }) =>
      expansionCacheKey({
        namespace: namespaceNow(),
        position: context.position,
        topic,
        ancestorTopics: context.ancestors.map((a) => a.topic),
        learner: context.learner === undefined ? undefined : learnerFingerprint(context.learner),
      }),
    get: (key: string): Promise<Expansion | undefined> => deps.cache.get(key),
    put: (key: string, output: Expansion): Promise<void> => deps.cache.put(key, output),
  };
}

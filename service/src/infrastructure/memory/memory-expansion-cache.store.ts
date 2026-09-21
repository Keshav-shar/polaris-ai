import type { ExpansionCachePort } from "../../application/ports/expansion-cache.port";
import type { ExpandOutput } from "../../domain/schemas/node.schema";

// Process-lifetime only, so a fresh CLI run starts cold; it saves calls within one run and across runs in
// a long-lived API process. Phase 12 replaces it with a Postgres table keyed the same way (the key already
// carries PROMPT_VERSION and the model, so that table needs those as columns to survive restarts).
export function createMemoryExpansionCache(): ExpansionCachePort {
  const entries = new Map<string, ExpandOutput>();

  // Copy on both sides: a caller must not be able to mutate a stored entry through the array it got back.
  const clone = (output: ExpandOutput): ExpandOutput => ({ ...output, children: [...output.children] });

  return {
    async get(key) {
      const hit = entries.get(key);
      return hit === undefined ? undefined : clone(hit);
    },
    async put(key, output) {
      entries.set(key, clone(output));
    },
  };
}

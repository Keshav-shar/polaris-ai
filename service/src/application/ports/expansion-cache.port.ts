import type { Expansion } from "../../domain/schemas/node.schema";

// Identical expansion requests reuse a stored result instead of paying for another LLM call, and so also
// yield identical child ids across runs (docs/conflicts.md C47). In memory now, Postgres from Phase 12.
export type ExpansionCachePort = {
  // Resolves undefined on a miss; never throws for one.
  get(key: string): Promise<Expansion | undefined>;
  // A failure here must not fail the node: the caller warns and carries on.
  put(key: string, output: Expansion): Promise<void>;
};

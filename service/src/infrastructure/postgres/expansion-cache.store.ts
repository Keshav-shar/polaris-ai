import { z } from "zod";
import type { ExpansionCachePort } from "../../application/ports/expansion-cache.port";
import { Brief, ChildDraft, type Expansion, Topic } from "../../domain/schemas/node.schema";
import { check } from "./postgres-error";
import type { Db } from "./supabase.client";

// The cached value is re-validated as a VERIFIED expansion: a hit skips the verifier, so a stored value that no
// longer satisfies it (a schema tightened since) must read as a miss, not reach the tree.
const StoredExpansion = z.object({
  topic: Topic.optional(),
  brief: Brief.optional(),
  children: z.array(ChildDraft),
});

// Shared across users: it holds model output for a topic, never a learner's raw request (C47).
export function createPostgresExpansionCache(db: Db): ExpansionCachePort {
  return {
    async get(key) {
      const result = await db.from("expansion_cache").select("value").eq("key", key).maybeSingle();
      check("expansion_cache.get", result);
      if (result.data === null) return undefined;
      const parsed = StoredExpansion.safeParse(z.object({ value: z.unknown() }).parse(result.data).value);
      if (!parsed.success) return undefined;
      const { topic, brief, children } = parsed.data;
      const expansion: Expansion = { children };
      if (topic !== undefined) expansion.topic = topic;
      if (brief !== undefined) expansion.brief = brief;
      return expansion;
    },

    async put(key, output) {
      check(
        "expansion_cache.put",
        await db.from("expansion_cache").upsert({ key, value: output }, { onConflict: "key" }),
      );
    },
  };
}

import { z } from "zod";

// Raw parser LLM output. maxDepth is null when the user stated no depth; mapping and clamping happen after.
export const RawParserOutput = z.object({
  topic: z.string(),
  maxDepth: z.number().int().nullable(),
});
export type RawParserOutput = z.infer<typeof RawParserOutput>;

// Consolidator LLM output: groups of 1-based indices into the numbered child list, most important first.
// Index validity and the EXPAND.MAX_CHILDREN cap are checked in code, so an overlong reply is trimmed, not repaired.
export const ConsolidatorOutput = z.object({
  groups: z
    .array(
      z.object({
        members: z.array(z.number().int().min(1)).min(1),
        topic: z.string().trim().min(1), // used only for merged groups; single members keep their original text
      }),
    )
    .min(1),
});
export type ConsolidatorOutput = z.infer<typeof ConsolidatorOutput>;

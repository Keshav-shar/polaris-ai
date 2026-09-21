import { z } from "zod";
import { ARTICLE } from "../../config/constants";
import { countWords } from "../../shared/words";
import { EvidenceItem } from "./evidence.schema";

// Strict: a children key is rejected, so children's material can never reach the writer.
export const ArticleContext = z.strictObject({
  node: z.strictObject({
    id: z.uuid(),
    topic: z.string(),
    depth: z.number().int().min(0),
    brief: z.string(),
  }),
  parent: z.strictObject({ topic: z.string(), brief: z.string() }).nullable(), // null for the root
  isLeaf: z.boolean(),
  evidence: z.array(EvidenceItem),
});
export type ArticleContext = z.infer<typeof ArticleContext>;

// Word limit counts contentMd only; citations are excluded.
export const ArticleOutput = z.object({
  contentMd: z
    .string()
    .trim()
    .min(1)
    .refine((s) => countWords(s) <= ARTICLE.MAX_WORDS, {
      message: `article must be at most ${ARTICLE.MAX_WORDS} words`,
    }),
  citations: z.array(z.object({ url: z.url(), claim: z.string().min(1) })),
});
export type ArticleOutput = z.infer<typeof ArticleOutput>;

export const Article = ArticleOutput.extend({
  nodeId: z.uuid(),
  credibilityVerified: z.boolean(),
});
export type Article = z.infer<typeof Article>;

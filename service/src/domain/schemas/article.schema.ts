import { z } from "zod";
import { ARTICLE } from "../../config/constants";
import { countWords } from "../../shared/words";
import { EvidenceItem } from "./evidence.schema";
import { QuizQuestion } from "./quiz.schema";
import { HttpUrl } from "./url.schema";

// What the writer may see about a node. Every level is a strictObject, which is what makes the limits
// below structural rather than a matter of prompt discipline.
//
// The invariant changed three times. C86 replaced "children are absent" with "each child's TOPIC and
// BRIEF". C91 moved the article pass to run beside construction, before a child had expanded, which cut the
// payload to the TOPIC alone. C102 restores the brief: since C99 a parent's own expansion writes each
// child's brief, so it exists before the parent's article is queued. The writer can NAME a subtopic and say
// in a clause what it covers; a child's article, evidence and own children stay out of reach, so "one node,
// one slice" still holds.
export const ArticleContext = z.strictObject({
  node: z.strictObject({
    id: z.uuid(),
    topic: z.string(),
    depth: z.number().int().min(0),
    brief: z.string(),
  }),
  parent: z.strictObject({ topic: z.string(), brief: z.string() }).nullable(), // null for the root
  isLeaf: z.boolean(),
  // Signpost material only. strictObject per child, so a child's article, evidence or own children cannot
  // be smuggled in by a caller that builds the context by hand.
  children: z.array(z.strictObject({ topic: z.string(), brief: z.string() })),
  evidence: z.array(EvidenceItem),
});
export type ArticleContext = z.infer<typeof ArticleContext>;

// The cap here is the runaway guard (see ARTICLE in config/constants.ts); the target length is the
// band in domain/traversal/article-budget.ts. Counts contentMd only; citations are excluded.
export const ArticleOutput = z.object({
  contentMd: z
    .string()
    .trim()
    .min(1)
    .refine((s) => countWords(s) <= ARTICLE.MAX_WORDS, {
      message: `article must be at most ${ARTICLE.MAX_WORDS} words`,
    }),
  // HttpUrl, not z.url(): a citation is rendered as a clickable href, and z.url() accepts a javascript: URL.
  citations: z.array(z.object({ url: HttpUrl, claim: z.string().min(1) })),
});
export type ArticleOutput = z.infer<typeof ArticleOutput>;

export const Article = ArticleOutput.extend({
  nodeId: z.uuid(),
  credibilityVerified: z.boolean(),
});
export type Article = z.infer<typeof Article>;

// What ONE writer call returns: the article and its questions together (docs/conflicts.md C74). Bundling
// them costs no extra LLM request, which is why the quiz is no longer generated on demand.
//
// `questions` is OPTIONAL, and deliberately so: every QuizQuestion must cite an evidence URL, so a node
// whose credibility gate found ZERO credible sources cannot produce questions at all and regeneration
// could not invent them. Such a node still gets its article, marked unverified, and simply has no quiz
// (C80). The length is only checked when questions are present, by QuizOutput at the point of storage.
export const WriterOutput = ArticleOutput.extend({
  questions: z.array(QuizQuestion).optional(),
});
export type WriterOutput = z.infer<typeof WriterOutput>;

// What the article pass STORES as a node's draft (idempotency rule 2): the writer's output plus the
// credibility verdict it was written under. The verdict has to travel with the draft, because a redelivery
// reuses the draft without searching again and so cannot recompute it (C118). Verified = the gate passed
// (enough credible sources) AND the article cites at least one of them: a passed gate the writer ignored
// is not a sourced article.
export const ArticleDraft = WriterOutput.extend({ credibilityVerified: z.boolean() });
export type ArticleDraft = z.infer<typeof ArticleDraft>;

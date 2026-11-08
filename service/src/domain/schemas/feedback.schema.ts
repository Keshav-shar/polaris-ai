// Relative imports only: ui/ type-checks this file, and there `@/` points at ui/src (docs/conflicts.md C41).
import { z } from "zod";
import { FEEDBACK } from "../../config/constants";

// What a learner can say about one lesson (C138): a thumb and a few FIXED tags, never free text. Free text would
// be untrusted input that ends up summarised into later prompts; a closed vocabulary carries the same signal with
// no injection surface and costs nothing to aggregate.
export const FeedbackTag = z.enum([
  "too-basic",
  "too-advanced",
  "too-long",
  "too-short",
  "needs-examples",
  "unclear",
  "just-right",
]);
export type FeedbackTag = z.infer<typeof FeedbackTag>;

// PUT /api/nodes/:nodeId/feedback. strictObject: an extra field (a "comment") is refused, not ignored, so a client
// cannot believe it stored text that was silently dropped.
export const LessonFeedbackBody = z.strictObject({
  // null = no thumb given, only tags.
  helpful: z.boolean().nullable(),
  tags: z
    .array(FeedbackTag)
    .max(FEEDBACK.MAX_TAGS)
    .refine((tags) => new Set(tags).size === tags.length, { message: "tags must not repeat" }),
});
export type LessonFeedbackBody = z.infer<typeof LessonFeedbackBody>;

export const LessonFeedback = LessonFeedbackBody.extend({ updatedAt: z.iso.datetime({ offset: true }) });
export type LessonFeedback = z.infer<typeof LessonFeedback>;

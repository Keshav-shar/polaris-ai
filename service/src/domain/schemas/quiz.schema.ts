import { z } from "zod";
import { HttpUrl } from "./url.schema";
import { QUIZ_CONFIG } from "../../config/constants";

const OPTIONS_PER_QUESTION = 4;

export const QuizQuestion = z.object({
  question: z.string().trim().min(1),
  options: z.array(z.string().trim().min(1)).length(OPTIONS_PER_QUESTION),
  answerIndex: z.number().int().min(0).max(OPTIONS_PER_QUESTION - 1),
  explanation: z.string().trim().min(1),
  evidenceUrl: HttpUrl, // every question cites the node's evidence, and it is rendered as an href
});
export type QuizQuestion = z.infer<typeof QuizQuestion>;

// Shape is the sitewide QUIZ_CONFIG, never per-topic.
export const QuizOutput = z.object({
  questions: z.array(QuizQuestion).length(QUIZ_CONFIG.QUESTIONS_PER_TOPIC),
});
export type QuizOutput = z.infer<typeof QuizOutput>;

export const Quiz = QuizOutput.extend({ nodeId: z.uuid() });
export type Quiz = z.infer<typeof Quiz>;

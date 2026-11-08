import { z } from "zod";
import { INSIGHT } from "../../config/constants";

// What Polaris has inferred about one learner from their own feedback tags and quiz results (C134, C139). Two of
// the three fields are closed vocabularies, rendered into prompts as FIXED sentences written in code
// (application/agents/learner.prompt.ts); only `guidance` is model-written text, and it travels inside a data
// block, bounded, like every other piece of untrusted text (C103).
export const LearnerLevel = z.enum(["introductory", "standard", "advanced"]);
export type LearnerLevel = z.infer<typeof LearnerLevel>;

export const LearnerPreference = z.enum(["more-examples", "shorter", "more-depth", "plainer-language"]);
export type LearnerPreference = z.infer<typeof LearnerPreference>;

// The insight call's reply, and the compact profile that rides every NodeMessage of the learner's next build.
export const LearnerProfile = z.object({
  level: LearnerLevel,
  // No transform here: this schema is also turned into the strict json_schema the call sends (C114), which a
  // transform cannot be. The agent removes repeats.
  preferences: z.array(LearnerPreference).max(LearnerPreference.options.length),
  guidance: z.string().trim().max(INSIGHT.MAX_GUIDANCE_CHARS),
});
export type LearnerProfile = z.infer<typeof LearnerProfile>;

// The stored insight, one per learner (learner_insights, 0014).
export const LearnerInsight = z.object({
  userId: z.uuid(),
  profile: LearnerProfile,
  // The newest signal (feedback or quiz result) this insight was computed from. A later signal is what makes
  // the next refresh worth an LLM call; none means the job is a no-op.
  sourceThrough: z.iso.datetime({ offset: true }),
  promptVersion: z.string(),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type LearnerInsight = z.infer<typeof LearnerInsight>;

// One unit of work on the insight queue: "this learner just finished a map; refresh what we know about them".
export const InsightMessage = z.object({ userId: z.uuid(), runId: z.uuid() });
export type InsightMessage = z.infer<typeof InsightMessage>;

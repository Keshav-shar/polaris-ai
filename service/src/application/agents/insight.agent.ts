import type { LearnerSignals } from "../../domain/entities/learner-signals";
import { LearnerProfile } from "../../domain/schemas/insight.schema";
import type { GenerateStructured } from "../llm/structured";
import { buildInsightUserPrompt, INSIGHT_SYSTEM_PROMPT } from "./insight.prompt";

export type InsightAgent = {
  infer(signals: LearnerSignals): Promise<LearnerProfile>;
};

// ONE call per refresh, per learner - never per node, so the two-calls-per-node rule is untouched (C99, C139). It
// runs on the expand pool at low effort and in the lowest priority lane: no learner is waiting on it.
export function createInsightAgent({ generate }: { generate: GenerateStructured }): InsightAgent {
  return {
    async infer(signals) {
      const output = await generate({
        schema: LearnerProfile,
        system: INSIGHT_SYSTEM_PROMPT,
        user: buildInsightUserPrompt(signals),
        label: "insight",
        priority: { lane: "insight", depth: 0 },
      });
      // Parsed once more after the de-duplication, so what is stored is exactly what the schema allows.
      return LearnerProfile.parse({ ...output, preferences: [...new Set(output.preferences)] });
    },
  };
}

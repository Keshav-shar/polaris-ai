import { z } from "zod";
import type { InsightPort } from "../../application/ports/insight.port";
import { type LearnerInsight, LearnerProfile } from "../../domain/schemas/insight.schema";
import { check } from "./postgres-error";
import type { Db } from "./supabase.client";

const COLUMNS = "user_id, level, preferences, guidance, source_through, prompt_version, updated_at";

const InsightRow = z.object({
  user_id: z.uuid(),
  level: z.unknown(),
  preferences: z.unknown(),
  guidance: z.unknown(),
  source_through: z.string(),
  prompt_version: z.string(),
  updated_at: z.string(),
});

// learner_insights (0014). The profile is re-validated on the way OUT as well as in: it enters prompts, so a row
// edited by hand into something longer or stranger must fail here rather than reach a model.
export function createPostgresInsightRepository(db: Db): InsightPort {
  return {
    async get(userId) {
      const result = await db.from("learner_insights").select(COLUMNS).eq("user_id", userId).maybeSingle();
      check("insights.get", result);
      if (result.data === null) return undefined;
      const row = InsightRow.parse(result.data);
      const insight: LearnerInsight = {
        userId: row.user_id,
        profile: LearnerProfile.parse({ level: row.level, preferences: row.preferences, guidance: row.guidance }),
        sourceThrough: new Date(row.source_through).toISOString(),
        promptVersion: row.prompt_version,
        updatedAt: new Date(row.updated_at).toISOString(),
      };
      return insight;
    },

    async put(insight) {
      const profile = LearnerProfile.parse(insight.profile);
      check(
        "insights.put",
        await db.from("learner_insights").upsert(
          {
            user_id: insight.userId,
            level: profile.level,
            preferences: profile.preferences,
            guidance: profile.guidance,
            source_through: insight.sourceThrough,
            prompt_version: insight.promptVersion,
            updated_at: insight.updatedAt,
          },
          { onConflict: "user_id" },
        ),
      );
    },
  };
}

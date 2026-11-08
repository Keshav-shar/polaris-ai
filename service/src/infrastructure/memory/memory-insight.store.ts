import type { InsightPort } from "../../application/ports/insight.port";
import type { LearnerInsight } from "../../domain/schemas/insight.schema";

// learner_insights in memory: one row per user.
export function createMemoryInsightStore(): InsightPort {
  const rows = new Map<string, LearnerInsight>();
  const copy = (insight: LearnerInsight): LearnerInsight => ({
    ...insight,
    profile: { ...insight.profile, preferences: [...insight.profile.preferences] },
  });
  return {
    async get(userId) {
      const row = rows.get(userId);
      return row === undefined ? undefined : copy(row);
    },
    async put(insight) {
      rows.set(insight.userId, copy(insight));
    },
  };
}

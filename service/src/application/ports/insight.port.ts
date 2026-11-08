import type { InsightMessage, LearnerInsight } from "../../domain/schemas/insight.schema";

// The stored learner insight, one per user (`learner_insights`, 0014). Read at kickoff (one row, no LLM call,
// C100) and written by the background refresh job only.
export type InsightPort = {
  get(userId: string): Promise<LearnerInsight | undefined>;
  put(insight: LearnerInsight): Promise<void>;
};

// Producer half of the insight queue (C139): a learner finished a map, refresh what is known about them. In
// memory locally; SQS `polaris-insight-refresh` in Phase 13. Fire-and-forget by design: the job is idempotent
// (no new signal = no call), so a lost or doubled message costs at most one refresh.
export type InsightQueuePort = {
  send(message: InsightMessage): Promise<void>;
};

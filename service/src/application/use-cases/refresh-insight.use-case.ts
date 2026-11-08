import { INSIGHT, PROMPT_VERSION } from "../../config/constants";
import { hasNewSignals, summarizeSignals } from "../../domain/entities/learner-signals";
import type { InsightMessage } from "../../domain/schemas/insight.schema";
import type { Logger } from "../../shared/logger";
import type { InsightAgent } from "../agents/insight.agent";
import type { FeedbackPort } from "../ports/feedback.port";
import type { InsightPort } from "../ports/insight.port";
import type { ProgressPort } from "../ports/progress.port";
import type { UsagePort } from "../ports/usage.port";

// What one refresh did. Every outcome but `updated` spent NO LLM call - that is the point of checking in this order.
export type RefreshOutcome = "no-new-signals" | "too-few-signals" | "daily-cap" | "updated";

export type RefreshInsight = {
  execute(message: InsightMessage): Promise<RefreshOutcome>;
};

// The background job behind C139: a learner finished a map, so recompute what Polaris knows about them from their
// own tags and quiz results. Idempotent by construction - it only calls the model when there is a signal newer
// than the stored insight, so a duplicate or replayed message is a no-op. Never runs inside a request.
export function createRefreshInsight({
  feedback,
  progress,
  insights,
  usage,
  agent,
  logger,
  now = Date.now,
}: {
  feedback: FeedbackPort;
  progress: ProgressPort;
  insights: InsightPort;
  usage: UsagePort;
  agent: InsightAgent;
  logger: Pick<Logger, "info">;
  now?: () => number;
}): RefreshInsight {
  return {
    async execute({ userId, runId }) {
      const [current, recentFeedback, recentProgress] = await Promise.all([
        insights.get(userId),
        feedback.listRecent(userId, INSIGHT.MAX_SIGNALS),
        progress.listRecent(userId, INSIGHT.MAX_SIGNALS),
      ]);
      if (!hasNewSignals(recentFeedback, recentProgress, current?.sourceThrough)) return "no-new-signals";

      const signals = summarizeSignals(recentFeedback, recentProgress);
      if (signals.signals < INSIGHT.MIN_SIGNALS || signals.newest === undefined) return "too-few-signals";

      // Taken last among the refusals, so a refresh that would have been skipped anyway never spends one.
      if (!(await usage.reserveInsight(userId, INSIGHT.MAX_PER_USER_PER_DAY))) return "daily-cap";

      const profile = await agent.infer(signals);
      await insights.put({
        userId,
        profile,
        sourceThrough: new Date(Date.parse(signals.newest)).toISOString(),
        promptVersion: PROMPT_VERSION,
        updatedAt: new Date(now()).toISOString(),
      });
      // Counts only: what the learner is like stays out of the logs.
      logger.info("learner insight refreshed", { userId, runId, signals: signals.signals });
      return "updated";
    },
  };
}

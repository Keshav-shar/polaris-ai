import type { FeedbackPort } from "../../application/ports/feedback.port";
import type { LessonFeedback } from "../../domain/schemas/feedback.schema";

type Row = LessonFeedback & { userId: string; nodeId: string; runId: string };

// lesson_feedback in memory: one row per (user, node), replaced on every save.
export function createMemoryFeedbackStore({ now = Date.now }: { now?: () => number } = {}): FeedbackPort {
  const rows = new Map<string, Row>();
  const keyOf = (userId: string, nodeId: string): string => `${userId}#${nodeId}`;
  const view = ({ helpful, tags, updatedAt }: Row): LessonFeedback => ({ helpful, tags: [...tags], updatedAt });

  return {
    async upsert({ userId, nodeId, runId }, feedback) {
      const row: Row = {
        userId,
        nodeId,
        runId,
        helpful: feedback.helpful,
        tags: [...feedback.tags],
        updatedAt: new Date(now()).toISOString(),
      };
      rows.set(keyOf(userId, nodeId), row);
      return view(row);
    },

    async get(userId, nodeId) {
      const row = rows.get(keyOf(userId, nodeId));
      return row === undefined ? undefined : view(row);
    },

    async listRecent(userId, limit) {
      return [...rows.values()]
        .filter((row) => row.userId === userId)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, limit)
        .map(view);
    },
  };
}

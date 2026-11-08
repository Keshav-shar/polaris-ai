import type { ProgressPort } from "../../application/ports/progress.port";
import type { ProgressSignal } from "../../domain/entities/learner-signals";
import type { NodeProgress, RunProgress } from "../../domain/schemas/progress.schema";

type Row = { userId: string; nodeId: string; runId: string; readAt?: string; attempts: number; best?: number; updatedAt: string };

// node_progress in memory. Each method's read-modify-write has no await inside it, so the event loop makes it as
// atomic as the RPC it stands in for.
export function createMemoryProgressStore({ now = Date.now }: { now?: () => number } = {}): ProgressPort {
  const rows = new Map<string, Row>();
  const keyOf = (userId: string, nodeId: string): string => `${userId}#${nodeId}`;
  const stamp = (): string => new Date(now()).toISOString();
  const view = (row: Row): NodeProgress => ({
    read: row.readAt !== undefined,
    quizAttempts: row.attempts,
    ...(row.best === undefined ? {} : { quizBest: row.best }),
  });
  const upsert = (userId: string, nodeId: string, runId: string): Row => {
    const key = keyOf(userId, nodeId);
    const existing = rows.get(key);
    if (existing !== undefined) return existing;
    const row: Row = { userId, nodeId, runId, attempts: 0, updatedAt: stamp() };
    rows.set(key, row);
    return row;
  };

  return {
    async markRead({ userId, nodeId, runId }) {
      const row = upsert(userId, nodeId, runId);
      if (row.readAt === undefined) {
        row.readAt = stamp();
        row.updatedAt = row.readAt;
      }
    },

    async recordQuizAttempt({ userId, nodeId, runId }, correct) {
      const row = upsert(userId, nodeId, runId);
      row.attempts += 1;
      row.best = Math.max(row.best ?? 0, correct);
      row.updatedAt = stamp();
      return view(row);
    },

    async get(userId, nodeId) {
      const row = rows.get(keyOf(userId, nodeId));
      return row === undefined ? undefined : view(row);
    },

    async listForRun(userId, runId) {
      const out: RunProgress = {};
      for (const row of rows.values()) {
        if (row.userId === userId && row.runId === runId) out[row.nodeId] = view(row);
      }
      return out;
    },

    async listRecent(userId, limit) {
      const mine: ProgressSignal[] = [...rows.values()]
        .filter((row) => row.userId === userId)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .slice(0, limit)
        .map((row) => ({ ...view(row), updatedAt: row.updatedAt }));
      return mine;
    },
  };
}

import type { UsagePort } from "../../application/ports/usage.port";

// usage_daily in memory: one counter per (user, UTC day, kind). The clock is injected so a test can cross midnight.
export function createMemoryUsageStore({ now = Date.now }: { now?: () => number } = {}): UsagePort {
  const counts = new Map<string, number>();
  const reserve = (kind: string, userId: string, limit: number): boolean => {
    const key = `${kind}#${userId}#${new Date(now()).toISOString().slice(0, 10)}`;
    const used = counts.get(key) ?? 0;
    // Refused reservations count nothing, exactly like the RPC's conditional update.
    if (used >= limit) return false;
    counts.set(key, used + 1);
    return true;
  };
  return {
    async reserveRun(userId, limit) {
      return reserve("run", userId, limit);
    },
    async reserveInsight(userId, limit) {
      return reserve("insight", userId, limit);
    },
  };
}

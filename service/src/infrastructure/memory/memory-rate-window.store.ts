import type { RateWindowPort } from "../../application/ports/rate-window.port";

const MINUTE_MS = 60_000;

// Same atomicity contract as memory-node-state.store.ts: no await between the read and the write, so the check
// and the count are one step, as the DynamoDB conditional ADD is. One entry per key: a new minute replaces the
// old one, so memory stays bounded by the number of models.
export function createMemoryRateWindowStore(): RateWindowPort {
  const windows = new Map<string, { minute: number; count: number }>();

  return {
    async tryAcquire(key, limit, nowMs) {
      const minute = Math.floor(nowMs / MINUTE_MS);
      const current = windows.get(key);
      const count = current?.minute === minute ? current.count : 0;
      if (count >= limit) return { ok: false, retryAfterMs: (minute + 1) * MINUTE_MS - nowMs };
      windows.set(key, { minute, count: count + 1 });
      return { ok: true };
    },
  };
}

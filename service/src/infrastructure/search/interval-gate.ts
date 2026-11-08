// Spaces calls to a provider that allows one request per interval (GDELT: one every 5 s, C146). Process-wide:
// one gate per adapter instance, shared by every article worker in the process. Reservations are handed out in
// order, so concurrent callers queue rather than all firing at the same instant.
//
// A caller whose slot is further away than `maxWaitMs` is refused at once (`acquire` resolves false) instead of
// waiting: a lesson skips the provider rather than holding its article hostage. Clock and sleep are injected, so
// the gate is testable without real time passing.
export type IntervalGate = { acquire(signal?: AbortSignal): Promise<boolean> };

export function createIntervalGate({
  minIntervalMs,
  maxWaitMs,
  now = Date.now,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: {
  minIntervalMs: number;
  maxWaitMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): IntervalGate {
  let nextFreeAt = 0;
  return {
    async acquire(signal) {
      const current = now();
      const slot = Math.max(current, nextFreeAt);
      const wait = slot - current;
      if (wait > maxWaitMs) return false;
      nextFreeAt = slot + minIntervalMs;
      if (wait > 0) await sleep(wait);
      return signal?.aborted !== true;
    },
  };
}

// A Sleep that never waits: it records the requested delays and resolves at once, so retry/backoff tests
// assert the schedule instead of living through it. `now` advances by whatever was slept, so cooldown
// tests (the model pool) can cross a deadline without timers. Existing callers destructure only
// `sleep`/`sleeps` and are unaffected.
export function fakeClock(start = 0) {
  const sleeps: number[] = [];
  let current = start;
  const now = (): number => current;
  const sleep = async (ms: number): Promise<void> => {
    sleeps.push(ms);
    current += ms;
  };
  // Move time on without recording a sleep, for "the cooldown expired on its own" cases.
  const advance = (ms: number): void => {
    current += ms;
  };
  return { sleep, sleeps, now, advance };
}

export type FakeClock = ReturnType<typeof fakeClock>;

// A deterministic stand-in for setTimeout, for the one place the code genuinely needs a timer: the memory
// queue's delayed redelivery (C94). Callbacks run only when the test advances time, so a 15-second
// visibility delay costs a test nothing and never races.
export function fakeScheduler(clock: FakeClock) {
  let pending: { at: number; run: () => void }[] = [];
  const schedule = (ms: number, run: () => void): (() => void) => {
    const entry = { at: clock.now() + ms, run };
    pending.push(entry);
    return () => {
      pending = pending.filter((p) => p !== entry);
    };
  };
  // Advances the clock and fires everything that came due, earliest first.
  const advance = (ms: number): void => {
    clock.advance(ms);
    const due = pending.filter((p) => p.at <= clock.now()).sort((a, b) => a.at - b.at);
    pending = pending.filter((p) => p.at > clock.now());
    for (const entry of due) entry.run();
  };
  return { schedule, advance, pendingCount: () => pending.length };
}

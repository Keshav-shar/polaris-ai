// A Sleep that never waits: it records the requested delays and resolves at once, so retry/backoff tests
// assert the schedule instead of living through it.
export function fakeClock() {
  const sleeps: number[] = [];
  const sleep = async (ms: number): Promise<void> => {
    sleeps.push(ms);
  };
  return { sleep, sleeps };
}

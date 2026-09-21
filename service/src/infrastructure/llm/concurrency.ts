export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

// Runs at most `n` tasks at once; the rest wait in FIFO order.
export function createLimiter(n: number): Limiter {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Limiter size must be an integer >= 1, got ${n}`);

  let active = 0;
  const waiting: (() => void)[] = [];

  const acquire = (): Promise<void> => {
    if (active < n) {
      active++;
      return Promise.resolve();
    }
    // The slot is handed over directly by release(), so `active` is not incremented here.
    return new Promise((resolve) => waiting.push(resolve));
  };

  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  return async (task) => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
}

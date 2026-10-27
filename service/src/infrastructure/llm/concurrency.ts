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

// Compared element by element, lower first: [lane, depth] for an LLM call (C129).
export type Priority = readonly number[];

export type PriorityLimiter = <T>(priority: Priority, task: () => Promise<T>) => Promise<T>;

function before(a: Priority, b: Priority): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

// createLimiter with an ordered wait list: a freed slot goes to the best-ranked waiter, arrival order breaking
// ties. Nothing already running is pre-empted, so a boosted call waits at most for the next slot to free.
export function createPriorityLimiter(n: number): PriorityLimiter {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Limiter size must be an integer >= 1, got ${n}`);

  let active = 0;
  const waiting: { priority: Priority; start: () => void }[] = [];

  const acquire = (priority: Priority): Promise<void> => {
    if (active < n) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const entry = { priority, start: resolve };
      // Sorted insert AFTER every equal rank, which is what keeps ties in arrival order. Waits are short lists (bounded by the workers' concurrency), so a scan is cheaper than a heap.
      const at = waiting.findIndex((w) => before(priority, w.priority));
      if (at === -1) waiting.push(entry);
      else waiting.splice(at, 0, entry);
    });
  };

  const release = (): void => {
    const next = waiting.shift();
    // The slot is handed over directly, so `active` is not decremented and re-incremented.
    if (next) next.start();
    else active--;
  };

  return async (priority, task) => {
    await acquire(priority);
    try {
      return await task();
    } finally {
      release();
    }
  };
}

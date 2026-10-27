import { describe, expect, it } from "vitest";
import { createMemoryRateWindowStore } from "../../../../src/infrastructure/memory/memory-rate-window.store";

const MINUTE = 60_000;

describe("createMemoryRateWindowStore (A13, C130)", () => {
  it("counts up to the limit inside one minute, then refuses until that minute ends", async () => {
    const window = createMemoryRateWindowStore();
    const start = 10 * MINUTE + 15_000;
    for (let i = 0; i < 3; i++) await expect(window.tryAcquire("m", 3, start + i)).resolves.toEqual({ ok: true });
    await expect(window.tryAcquire("m", 3, start + 5)).resolves.toEqual({ ok: false, retryAfterMs: 45_000 - 5 });
  });

  it("starts afresh at the minute boundary", async () => {
    const window = createMemoryRateWindowStore();
    await window.tryAcquire("m", 1, 5 * MINUTE + 59_999);
    await expect(window.tryAcquire("m", 1, 5 * MINUTE + 59_999)).resolves.toMatchObject({ ok: false });
    await expect(window.tryAcquire("m", 1, 6 * MINUTE)).resolves.toEqual({ ok: true });
  });

  it("keeps one window per key, so two models never share a count", async () => {
    const window = createMemoryRateWindowStore();
    await window.tryAcquire("a", 1, 0);
    await expect(window.tryAcquire("a", 1, 1)).resolves.toMatchObject({ ok: false });
    await expect(window.tryAcquire("b", 1, 1)).resolves.toEqual({ ok: true });
  });

  it("counts nothing on a refusal", async () => {
    const window = createMemoryRateWindowStore();
    await window.tryAcquire("m", 1, 0);
    await window.tryAcquire("m", 1, 1);
    await window.tryAcquire("m", 1, 2);
    // A higher limit later in the same minute sees exactly the one request that was admitted.
    await expect(window.tryAcquire("m", 2, 3)).resolves.toEqual({ ok: true });
    await expect(window.tryAcquire("m", 2, 4)).resolves.toMatchObject({ ok: false });
  });
});

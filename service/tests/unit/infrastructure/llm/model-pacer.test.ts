import { describe, expect, it } from "vitest";
import { createModelPacer } from "../../../../src/infrastructure/llm/model-pacer";
import { createMemoryRateWindowStore } from "../../../../src/infrastructure/memory/memory-rate-window.store";
import { fakeClock } from "../../../fixtures/fake-clock";

function pacer(requestsPerMinute = 30, model = "m") {
  const clock = fakeClock(0);
  const window = createMemoryRateWindowStore();
  return { clock, window, pacer: createModelPacer({ model, window, requestsPerMinute, now: clock.now }) };
}

describe("createModelPacer (C130)", () => {
  it("admits up to the requests/minute limit, then says how long until the minute ends", async () => {
    const { pacer: p, clock } = pacer(2);
    clock.advance(20_000);
    await expect(p.admit(10)).resolves.toEqual({ ok: true });
    await expect(p.admit(10)).resolves.toEqual({ ok: true });
    await expect(p.admit(10)).resolves.toEqual({ ok: false, retryAfterMs: 40_000 });
  });

  it("adopts the requests/minute limit a 429 body stated", async () => {
    const { pacer: p } = pacer(30);
    p.observeRequestsPerMinute(1);
    await expect(p.admit(10)).resolves.toEqual({ ok: true });
    await expect(p.admit(10)).resolves.toMatchObject({ ok: false });
  });

  it("ignores a nonsense limit rather than pacing on it", async () => {
    const { pacer: p } = pacer(2);
    p.observeRequestsPerMinute(0);
    p.observeRequestsPerMinute(Number.NaN);
    await expect(p.admit(1)).resolves.toEqual({ ok: true });
    await expect(p.admit(1)).resolves.toEqual({ ok: true });
  });

  it("holds a request the remaining tokens cannot cover, without counting it, until enough has refilled", async () => {
    const { pacer: p, clock } = pacer();
    // 8,000-token bucket, 2,000 left, full again in 30 s: refills at 0.2 tokens/ms.
    p.observeHeaders({ remainingTokens: 2_000, resetTokensMs: 30_000, limitTokens: 8_000 });
    await expect(p.admit(3_000)).resolves.toEqual({ ok: false, retryAfterMs: 5_000 });
    clock.advance(5_000);
    await expect(p.admit(3_000)).resolves.toEqual({ ok: true });
  });

  it("without the bucket size, waits for the stated reset", async () => {
    const { pacer: p, clock } = pacer();
    p.observeHeaders({ remainingTokens: 100, resetTokensMs: 7_660 });
    await expect(p.admit(500)).resolves.toEqual({ ok: false, retryAfterMs: 7_660 });
    clock.advance(7_660);
    await expect(p.admit(500)).resolves.toEqual({ ok: true });
  });

  it("takes an admitted request out of the headroom at once, so concurrent callers cannot spend it twice", async () => {
    const { pacer: p } = pacer();
    p.observeHeaders({ remainingTokens: 1_000, resetTokensMs: 60_000 });
    await expect(p.admit(800)).resolves.toEqual({ ok: true });
    await expect(p.admit(800)).resolves.toMatchObject({ ok: false });
  });

  it("lets through a request bigger than the whole bucket, for the provider to answer", async () => {
    const { pacer: p } = pacer();
    p.observeHeaders({ remainingTokens: 0, resetTokensMs: 60_000, limitTokens: 8_000 });
    await expect(p.admit(9_000)).resolves.toEqual({ ok: true });
  });

  it("is one counter per model, however many pools call it", async () => {
    // Composition hands the SAME pacer to the expand and the writer pool when both name a model: two
    // callers, one requests/minute budget.
    const { pacer: shared } = pacer(1);
    const expandPool = shared;
    const writerPool = shared;
    await expect(expandPool.admit(1)).resolves.toEqual({ ok: true });
    await expect(writerPool.admit(1)).resolves.toMatchObject({ ok: false });
  });
});

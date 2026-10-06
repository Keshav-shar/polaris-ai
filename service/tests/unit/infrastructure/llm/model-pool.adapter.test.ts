import { describe, expect, it } from "vitest";
import type { ChatMessage, LlmPort } from "../../../../src/application/ports/llm.port";
import { MODEL_POOL } from "../../../../src/config/constants";
import { QuotaExhaustedError } from "../../../../src/domain/errors/quota-exhausted.error";
import { TransportUnavailableError } from "../../../../src/domain/errors/transport-unavailable.error";
import {
  createModelPoolLlm,
  type ModelPoolDeps,
  type PoolMember,
} from "../../../../src/infrastructure/llm/model-pool.adapter";
import { fakeClock } from "../../../fixtures/fake-clock";
import { fakeLogger } from "../../../fixtures/fake-generate";

// A member that fails `failTimes` times with `failWith`, then answers. Records every prompt it saw, so a
// test can prove exactly which model served which call.
function member(model: string, reply: string, failWith?: unknown, failTimes = Infinity): PoolMember & {
  readonly calls: string[];
} {
  const calls: string[] = [];
  let failed = 0;
  const llm: LlmPort = {
    async chat(messages) {
      const last = messages[messages.length - 1];
      calls.push(last?.content ?? "");
      if (failWith !== undefined && failed < failTimes) {
        failed += 1;
        throw failWith;
      }
      return reply;
    },
  };
  return { llm, model, dailyRequestBudget: undefined, calls };
}

const tpm429 = {
  status: 429,
  message: "Rate limit reached ... on tokens per minute (TPM): Limit 8000, Used 7157, Requested 948.",
  headers: { "retry-after": "2" },
};

const ask = (llm: { chat: LlmPort["chat"] }, prompt = "hi") =>
  llm.chat([{ role: "user", content: prompt }] satisfies ChatMessage[]);

function pool(
  members: [PoolMember, ...PoolMember[]],
  overrides: Partial<ModelPoolDeps> = {},
): ReturnType<typeof createModelPoolLlm> & { clock: ReturnType<typeof fakeClock> } {
  const clock = fakeClock(1_000);
  const llm = createModelPoolLlm({
    members,
    policy: "throttle",
    maxConcurrency: 4,
    logger: fakeLogger().logger,
    sleep: clock.sleep,
    now: clock.now,
    ...overrides,
  });
  return Object.assign(llm, { clock });
}

describe("createModelPoolLlm", () => {
  it("answers from the lead and never touches the others while it works", async () => {
    const a = member("a", "from a");
    const b = member("b", "from b");
    const llm = pool([a, b]);
    await expect(ask(llm)).resolves.toBe("from a");
    expect(b.calls).toEqual([]);
    expect(llm.activeModel()).toBe("a");
  });

  describe("exhaustion policy (throughput-first: one model per tree)", () => {
    it("does NOT rotate on a per-minute 429 - the member owns that backoff (C50)", async () => {
      const a = member("a", "from a", tpm429);
      const b = member("b", "from b");
      const llm = pool([a, b], { policy: "exhaustion" });
      await expect(ask(llm)).rejects.toMatchObject({ status: 429 });
      expect(b.calls).toEqual([]);
    });

    it("rotates on a daily quota and completes the call that discovered it", async () => {
      const a = member("a", "from a", new QuotaExhaustedError("a"));
      const b = member("b", "from b");
      const llm = pool([a, b], { policy: "exhaustion" });
      await expect(ask(llm, "first")).resolves.toBe("from b");
      await ask(llm, "second");
      // The retired member is asked exactly once: the call that found the quota gone.
      expect(a.calls).toEqual(["first"]);
      expect(b.calls).toEqual(["first", "second"]);
      expect(llm.activeModel()).toBe("b");
    });

    it("retires a member proactively once its own requests/day are spent, wasting no 429", async () => {
      const a = { ...member("a", "from a"), dailyRequestBudget: 2 };
      const b = member("b", "from b");
      const llm = pool([a as PoolMember, b], { policy: "exhaustion" });
      await expect(ask(llm, "1")).resolves.toBe("from a");
      await expect(ask(llm, "2")).resolves.toBe("from a");
      // Budget spent by the successful call itself - no failing request is needed to discover it.
      await expect(ask(llm, "3")).resolves.toBe("from b");
    });
  });

  describe("throttle policy (quality-first: rotate on a per-minute 429)", () => {
    it("tries the next member IMMEDIATELY on a 429, without sleeping", async () => {
      const a = member("a", "from a", tpm429);
      const b = member("b", "from b");
      const llm = pool([a, b]);
      await expect(ask(llm)).resolves.toBe("from b");
      expect(llm.clock.sleeps).toEqual([]);
      expect(llm.activeModel()).toBe("b");
    });

    it("skips a cooling member until its stated wait passes, then uses it again", async () => {
      // A switch BACK, which C59 forbade across PROVIDERS. It is safe within one account only because
      // the cache namespace no longer follows the answering model (C69).
      const a = member("a", "from a", tpm429, 1);
      const b = member("b", "from b");
      const llm = pool([a, b]);

      await expect(ask(llm, "first")).resolves.toBe("from b");
      // Still inside a's 2s cooldown.
      llm.clock.advance(1_000);
      await expect(ask(llm, "second")).resolves.toBe("from b");
      expect(a.calls).toEqual(["first"]);
      // Past it.
      llm.clock.advance(1_500);
      await expect(ask(llm, "third")).resolves.toBe("from a");
    });

    it("sleeps only the SHORTEST remaining cooldown when every member is throttled", async () => {
      const a = member("a", "from a", { ...tpm429, headers: { "retry-after": "9" } }, 1);
      const b = member("b", "from b", { ...tpm429, headers: { "retry-after": "3" } }, 1);
      const llm = pool([a, b]);
      await expect(ask(llm)).resolves.toBe("from b");
      // Both cooled, then it waits for b (3s), the first to come back - not a (9s).
      expect(llm.clock.sleeps).toEqual([3_000]);
    });
  });

  it("retires a member the provider no longer offers, and answers from the next one", async () => {
    // Found live: Groq withdrew a model overnight. A 404 names THAT model - the key works and the request
    // is fine - so failing the node would waste a pool of healthy members. Before this, one withdrawn
    // model failed every node of the run.
    const gone = member("gone", "never", { status: 404, message: "The model `gone` does not exist" });
    const alive = member("alive", "from alive");
    const llm = pool([gone, alive], { policy: "exhaustion" });

    await expect(ask(llm, "first")).resolves.toBe("from alive");
    await expect(ask(llm, "second")).resolves.toBe("from alive");
    // Retirement is one-way: a withdrawn model does not come back mid-process.
    expect(gone.calls).toEqual(["first"]);
  });

  it("still fails when every member has been withdrawn", async () => {
    const a = member("a", "never", { status: 404, message: "no such model" });
    const b = member("b", "never", { status: 404, message: "no such model" });
    const llm = pool([a, b]);
    await expect(ask(llm)).rejects.toBeInstanceOf(QuotaExhaustedError);
  });

  it("rethrows a bad key at once without burning the pool", async () => {
    const a = member("a", "from a", { status: 401, message: "invalid api key" });
    const b = member("b", "from b");
    const llm = pool([a, b]);
    await expect(ask(llm)).rejects.toMatchObject({ status: 401 });
    // A shared key fails identically everywhere: rotating would learn the same thing once per model.
    expect(b.calls).toEqual([]);
  });

  it("never spends more provider requests per call than a single adapter would", async () => {
    const down = { status: 503, message: "overloaded" };
    const [a, b, c, d] = [member("a", "x", down), member("b", "x", down), member("c", "x", down), member("d", "x", down)];
    const llm = pool([a, b, c, d]);
    await expect(ask(llm)).rejects.toBeTruthy();
    // Four members each retrying to their own budget would spend many times a single adapter's cost.
    const total = [a, b, c, d].reduce((sum, m) => sum + m.calls.length, 0);
    expect(total).toBe(MODEL_POOL.MAX_ATTEMPTS);
  });

  it("raises QuotaExhaustedError only when every member is out for the DAY", async () => {
    const a = member("a", "x", new QuotaExhaustedError("a"));
    const b = member("b", "y", new QuotaExhaustedError("b"));
    const llm = pool([a, b]);
    const error = await ask(llm).catch((e: unknown) => e);
    // Naming the pool, so the message reads correctly when no single model is to blame.
    expect(error).toBeInstanceOf(QuotaExhaustedError);
    expect((error as QuotaExhaustedError).model).toContain("a");
  });

  it("rethrows RAW when members are merely cooling, so a transient wall never halts the run", async () => {
    // QuotaExhaustedError means "the DAY is gone" and makes the worker halt permanently. A per-minute
    // wall clears by itself, so it must not borrow that meaning.
    const a = member("a", "x", { status: 503, message: "overloaded" });
    const b = member("b", "y", { status: 503, message: "overloaded" });
    const llm = pool([a, b]);
    await expect(ask(llm)).rejects.not.toBeInstanceOf(QuotaExhaustedError);
  });

  it("never retries a retired member, even long after any cooldown would have expired", async () => {
    const a = member("a", "from a", new QuotaExhaustedError("a"));
    const b = member("b", "from b");
    const llm = pool([a, b]);
    await ask(llm, "first");
    llm.clock.advance(60 * 60 * 1000);
    await ask(llm, "second");
    expect(a.calls).toEqual(["first"]);
  });

  it("keeps the cache namespace fixed across rotation, but varies it by member ORDER", async () => {
    const a = member("a", "from a", new QuotaExhaustedError("a"));
    const b = member("b", "from b");
    const llm = pool([a, b]);
    const before = llm.cacheNamespace();
    await ask(llm);
    // This is what stops one member's answer being filed under another's key.
    expect(llm.cacheNamespace()).toBe(before);
    expect(llm.activeModel()).toBe("b");

    // Order decides the lead, so it decides the distribution of answers: different trees, different cache.
    const reversed = pool([member("b", "x"), member("a", "y")]);
    expect(reversed.cacheNamespace()).not.toBe(before);
  });

  it("caps in-flight calls across the WHOLE pool, not per member", async () => {
    let inFlight = 0;
    let peak = 0;
    const slow = (model: string): PoolMember => ({
      model,
      dailyRequestBudget: undefined,
      llm: {
        async chat() {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await Promise.resolve();
          inFlight -= 1;
          return "ok";
        },
      },
    });
    const llm = pool([slow("a"), slow("b"), slow("c"), slow("d")], { maxConcurrency: 2 });
    await Promise.all(Array.from({ length: 8 }, () => ask(llm)));
    // Four members each holding their own limiter would allow 8; the pool's single gate allows 2.
    expect(peak).toBeLessThanOrEqual(2);
  });

  describe("round-robin policy (capacity-first: spread before a limit is hit)", () => {
    it("starts each call at the next member, so three calls use three models", async () => {
      // Under throttle the lead answers all three and the others idle until it 429s, which is what makes
      // ONE model's tokens/minute the pool's ceiling (C92).
      const a = member("a", "from a");
      const b = member("b", "from b");
      const c = member("c", "from c");
      const llm = pool([a, b, c], { policy: "round-robin" });

      await expect(ask(llm)).resolves.toBe("from a");
      await expect(ask(llm)).resolves.toBe("from b");
      await expect(ask(llm)).resolves.toBe("from c");
      await expect(ask(llm)).resolves.toBe("from a");
      expect([a.calls.length, b.calls.length, c.calls.length]).toEqual([2, 1, 1]);
    });

    it("still rotates past a member that is cooling, and reports who answered", async () => {
      const a = member("a", "from a", tpm429, 1);
      const b = member("b", "from b");
      const llm = pool([a, b], { policy: "round-robin" });

      // Starts at a, which 429s, so b answers - the same reactive behaviour throttle has.
      await expect(ask(llm)).resolves.toBe("from b");
      expect(llm.activeModel()).toBe("b");
    });

    it("skips a retired member rather than counting it as this call's turn", async () => {
      const a = member("a", "x", new QuotaExhaustedError("a"));
      const b = member("b", "from b");
      const llm = pool([a, b], { policy: "round-robin" });

      await expect(ask(llm)).resolves.toBe("from b");
      await expect(ask(llm)).resolves.toBe("from b");
      // a was tried exactly once, when it retired itself; the cursor moving on does not resurrect it.
      expect(a.calls).toHaveLength(1);
    });
  });

  describe("an unreachable provider (C94)", () => {
    const connectionError = Object.assign(new Error("Connection error."), {
      cause: Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" }),
    });

    it("does not rotate: every member dials the same network", async () => {
      const a = member("a", "from a", connectionError);
      const b = member("b", "from b");
      const llm = pool([a, b]);

      await expect(ask(llm)).rejects.toBeInstanceOf(TransportUnavailableError);
      // b is untouched - walking the pool would spend the whole attempt budget learning the same thing
      // once per model, and it is not the pool that is broken.
      expect(a.calls).toHaveLength(1);
      expect(b.calls).toEqual([]);
    });

    it("carries the diagnosis, so the stored reason names the fault", async () => {
      const llm = pool([member("a", "x", connectionError)]);
      await expect(ask(llm)).rejects.toThrow(/ECONNRESET/);
    });

    it("is not a quota error, so the run is never halted for a blip", async () => {
      const llm = pool([member("a", "x", connectionError)]);
      await expect(ask(llm)).rejects.not.toBeInstanceOf(QuotaExhaustedError);
    });

    it("leaves the member usable: nothing is cooled or retired", async () => {
      const a = member("a", "from a", connectionError, 1);
      const llm = pool([a]);
      await expect(ask(llm)).rejects.toBeInstanceOf(TransportUnavailableError);
      // The very next call goes straight back to it, with no cooldown to wait out.
      await expect(ask(llm)).resolves.toBe("from a");
    });
  });

  it("logs a retirement once per transition, not once per call", async () => {
    const { logger, warnings } = fakeLogger();
    const a = member("a", "x", new QuotaExhaustedError("a"));
    const b = member("b", "from b");
    const llm = pool([a, b], { logger });
    await ask(llm);
    await ask(llm);
    await ask(llm);
    expect(warnings.filter((w) => w.msg.includes("member retired")).length).toBe(1);
  });
});

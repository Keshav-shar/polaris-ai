import { describe, expect, it } from "vitest";
import type { LlmPort } from "../../../../src/application/ports/llm.port";
import { QuotaExhaustedError } from "../../../../src/domain/errors/quota-exhausted.error";
import { createFailoverLlm } from "../../../../src/infrastructure/llm/failover.adapter";
import { fakeLogger } from "../../../fixtures/fake-generate";

// Records every call so a test can prove which provider actually answered.
function fakePort(reply: string, failWith?: unknown, failTimes = Infinity) {
  const calls: string[] = [];
  let failed = 0;
  const llm: LlmPort = {
    async chat(messages) {
      calls.push(String(messages[messages.length - 1]?.content ?? ""));
      if (failWith !== undefined && failed < failTimes) {
        failed += 1;
        throw failWith;
      }
      return reply;
    },
  };
  return { llm, calls };
}

const ask = (llm: LlmPort, content = "hi") => llm.chat([{ role: "user", content }]);
const quota = () => new QuotaExhaustedError("gemini-3.6-flash");

describe("createFailoverLlm", () => {
  it("answers from the primary while it works, and never touches the fallback", async () => {
    const primary = fakePort("from primary");
    const fallback = fakePort("from fallback");
    const llm = createFailoverLlm({
      primary: { llm: primary.llm, model: "gemini" },
      fallback: { llm: fallback.llm, model: "groq" },
      logger: fakeLogger().logger,
    });

    await expect(ask(llm)).resolves.toBe("from primary");
    expect(fallback.calls).toEqual([]);
    expect(llm.activeModel()).toBe("gemini");
  });

  it("switches on a daily quota and completes the call that triggered it", async () => {
    const primary = fakePort("from primary", quota());
    const fallback = fakePort("from fallback");
    const { logger, warnings } = fakeLogger();
    const llm = createFailoverLlm({
      primary: { llm: primary.llm, model: "gemini" },
      fallback: { llm: fallback.llm, model: "groq" },
      logger,
    });

    // The point of failover: the caller gets an answer rather than a halted run.
    await expect(ask(llm)).resolves.toBe("from fallback");
    expect(llm.activeModel()).toBe("groq");
    expect(warnings[0]?.msg).toBe("llm failover: daily quota exhausted, switching provider");
    expect(warnings[0]?.context).toMatchObject({ from: "gemini", to: "groq" });
  });

  it("is sticky: later calls go straight to the fallback, never back to the dead provider", async () => {
    const primary = fakePort("from primary", quota(), 1);
    const fallback = fakePort("from fallback");
    const llm = createFailoverLlm({
      primary: { llm: primary.llm, model: "gemini" },
      fallback: { llm: fallback.llm, model: "groq" },
      logger: fakeLogger().logger,
    });

    await ask(llm, "first");
    await ask(llm, "second");
    await ask(llm, "third");

    // The primary is asked exactly once - the call that discovered the quota was gone.
    expect(primary.calls).toEqual(["first"]);
    expect(fallback.calls).toEqual(["first", "second", "third"]);
  });

  it("switches only once, however many calls are in flight when the quota dies", async () => {
    const primary = fakePort("from primary", quota());
    const fallback = fakePort("from fallback");
    const { logger, warnings } = fakeLogger();
    const llm = createFailoverLlm({
      primary: { llm: primary.llm, model: "gemini" },
      fallback: { llm: fallback.llm, model: "groq" },
      logger,
    });

    await Promise.all([ask(llm, "a"), ask(llm, "b"), ask(llm, "c")]);
    expect(warnings.filter((w) => w.msg.startsWith("llm failover")).length).toBe(1);
  });

  it("does NOT spend the second quota on anything but a daily quota", async () => {
    // Per-minute limits, 5xx and bad JSON are already handled inside one adapter. Failing over on them
    // would burn the reserve provider on a condition that clears by itself.
    const primary = fakePort("from primary", new Error("429 per-minute; retry in 41s"));
    const fallback = fakePort("from fallback");
    const llm = createFailoverLlm({
      primary: { llm: primary.llm, model: "gemini" },
      fallback: { llm: fallback.llm, model: "groq" },
      logger: fakeLogger().logger,
    });

    await expect(ask(llm)).rejects.toThrow(/per-minute/);
    expect(fallback.calls).toEqual([]);
    expect(llm.activeModel()).toBe("gemini");
  });

  it("lets the quota error stand when BOTH providers are exhausted, so the worker halts", async () => {
    const primary = fakePort("x", quota());
    const fallback = fakePort("y", quota());
    const llm = createFailoverLlm({
      primary: { llm: primary.llm, model: "gemini" },
      fallback: { llm: fallback.llm, model: "groq" },
      logger: fakeLogger().logger,
    });

    await expect(ask(llm)).rejects.toThrow(QuotaExhaustedError);
    await expect(ask(llm)).rejects.toThrow(QuotaExhaustedError);
  });
});

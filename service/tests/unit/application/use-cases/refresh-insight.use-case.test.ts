import { describe, expect, it } from "vitest";
import { createInsightAgent } from "../../../../src/application/agents/insight.agent";
import { createRefreshInsight } from "../../../../src/application/use-cases/refresh-insight.use-case";
import { INSIGHT, PROMPT_VERSION } from "../../../../src/config/constants";
import { createMemoryFeedbackStore } from "../../../../src/infrastructure/memory/memory-feedback.store";
import { createMemoryInsightStore } from "../../../../src/infrastructure/memory/memory-insight.store";
import { createMemoryProgressStore } from "../../../../src/infrastructure/memory/memory-progress.store";
import { createMemoryUsageStore } from "../../../../src/infrastructure/memory/memory-usage.store";
import { fakeGenerate, fakeLogger } from "../../../fixtures/fake-generate";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const runId = "11111111-1111-4111-8111-111111111111";
const node = (n: number): string => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;

function setup() {
  let clock = Date.UTC(2026, 10, 7, 12, 0);
  const now = () => clock;
  const feedback = createMemoryFeedbackStore({ now });
  const progress = createMemoryProgressStore({ now });
  const insights = createMemoryInsightStore();
  const { generate, requests } = fakeGenerate(async () => ({
    level: "introductory",
    preferences: ["more-examples", "more-examples"],
    guidance: "Start from everyday examples before the formal terms.",
  }));
  const job = createRefreshInsight({
    feedback,
    progress,
    insights,
    usage: createMemoryUsageStore({ now }),
    agent: createInsightAgent({ generate }),
    logger: fakeLogger().logger,
    now,
  });
  const rate = async (n: number, tags: ("too-advanced" | "needs-examples" | "unclear")[]) => {
    clock += 1_000;
    await feedback.upsert({ userId, nodeId: node(n), runId }, { helpful: false, tags });
  };
  return { job, insights, requests, rate, tick: (ms: number) => (clock += ms) };
}

describe("refresh-insight (C139)", () => {
  it("makes NO call when the learner has given nothing new", async () => {
    const { job, requests } = setup();
    await expect(job.execute({ userId, runId })).resolves.toBe("no-new-signals");
    expect(requests).toHaveLength(0);
  });

  it("makes NO call under INSIGHT.MIN_SIGNALS", async () => {
    const { job, rate, requests } = setup();
    for (let i = 0; i < INSIGHT.MIN_SIGNALS - 1; i += 1) await rate(i, ["unclear"]);
    await expect(job.execute({ userId, runId })).resolves.toBe("too-few-signals");
    expect(requests).toHaveLength(0);
  });

  it("stores the profile, with counts - never text - in the prompt, on the insight lane", async () => {
    const { job, rate, requests, insights } = setup();
    await rate(1, ["too-advanced"]);
    await rate(2, ["needs-examples", "unclear"]);
    await rate(3, ["needs-examples"]);
    await expect(job.execute({ userId, runId })).resolves.toBe("updated");

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.label).toBe("insight");
    expect(request?.priority).toEqual({ lane: "insight", depth: 0 });
    expect(request?.user).toContain("<signals>");
    expect(request?.user).toContain("needs-examples: 2");

    const stored = await insights.get(userId);
    expect(stored?.profile).toEqual({
      level: "introductory",
      preferences: ["more-examples"], // de-duplicated
      guidance: "Start from everyday examples before the formal terms.",
    });
    expect(stored?.promptVersion).toBe(PROMPT_VERSION);
  });

  it("is idempotent: a replayed message after an update makes no second call", async () => {
    const { job, rate, requests } = setup();
    for (let i = 0; i < 3; i += 1) await rate(i, ["unclear"]);
    await job.execute({ userId, runId });
    await expect(job.execute({ userId, runId })).resolves.toBe("no-new-signals");
    expect(requests).toHaveLength(1);
  });

  it("stops at INSIGHT.MAX_PER_USER_PER_DAY", async () => {
    const { job, rate, requests } = setup();
    for (let i = 0; i < 3; i += 1) await rate(i, ["unclear"]);
    for (let day = 0; day < INSIGHT.MAX_PER_USER_PER_DAY; day += 1) {
      await expect(job.execute({ userId, runId })).resolves.toBe("updated");
      await rate(100 + day, ["unclear"]);
    }
    await expect(job.execute({ userId, runId })).resolves.toBe("daily-cap");
    expect(requests).toHaveLength(INSIGHT.MAX_PER_USER_PER_DAY);
  });
});

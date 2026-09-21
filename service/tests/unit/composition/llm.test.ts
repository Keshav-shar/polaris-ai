import { describe, expect, it } from "vitest";
import { parseEnv } from "../../../src/config/env";
import { createLlmFromEnv } from "../../../src/composition/llm";
import { fakeLogger } from "../../fixtures/fake-generate";

// Adapters are constructed here but never called, so this stays a no-network test.
const primary = {
  LLM_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  LLM_API_KEY: "gemini-key",
  LLM_MODEL: "gemini-3.6-flash",
};
const fallback = {
  LLM_FALLBACK_BASE_URL: "https://api.groq.com/openai/v1",
  LLM_FALLBACK_API_KEY: "groq-key",
  LLM_FALLBACK_MODEL: "groq-model",
};

describe("createLlmFromEnv", () => {
  it("runs on one provider when only one is configured", () => {
    const { logger, logs } = fakeLogger();
    const stack = createLlmFromEnv(parseEnv({ ...primary, LLM_DAILY_REQUEST_BUDGET: "20" }), logger);

    expect(stack.activeModel()).toBe("gemini-3.6-flash");
    expect(stack.dailyRequestBudget).toBe(20);
    expect(logs.find((l) => l.msg === "llm provider selected")?.context).toMatchObject({
      provider: "primary",
      model: "gemini-3.6-flash",
      failoverTo: null,
    });
  });

  it("wires the other profile as a failover target when it is complete", () => {
    const { logger, logs } = fakeLogger();
    const stack = createLlmFromEnv(parseEnv({ ...primary, ...fallback }), logger);

    expect(stack.activeModel()).toBe("gemini-3.6-flash");
    expect(logs.find((l) => l.msg === "llm provider selected")?.context).toMatchObject({
      failoverTo: "groq-model",
    });
  });

  it("budgets the SUM of both profiles when failover is live", () => {
    // What the run can actually draw on: the second tier is reached only once the first is exhausted.
    const stack = createLlmFromEnv(
      parseEnv({
        ...primary,
        ...fallback,
        LLM_DAILY_REQUEST_BUDGET: "20",
        LLM_FALLBACK_DAILY_REQUEST_BUDGET: "1000",
      }),
    );
    expect(stack.dailyRequestBudget).toBe(1020);
  });

  it("reports no budget at all when either profile's ceiling is unknown", () => {
    // Half the real budget is a worse warning than none: it would fire on builds that comfortably fit.
    const stack = createLlmFromEnv(
      parseEnv({ ...primary, ...fallback, LLM_DAILY_REQUEST_BUDGET: "20" }),
    );
    expect(stack.dailyRequestBudget).toBeUndefined();
  });

  it("honours LLM_PROVIDER: the named profile leads and the other is the reserve", () => {
    const stack = createLlmFromEnv(parseEnv({ ...primary, ...fallback, LLM_PROVIDER: "fallback" }));
    expect(stack.activeModel()).toBe("groq-model");
  });
});

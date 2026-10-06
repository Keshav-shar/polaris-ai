import { describe, expect, it } from "vitest";
import { parseEnv } from "../../../src/config/env";
import { createLlmFromEnv } from "../../../src/composition/llm";
import { fakeLogger } from "../../fixtures/fake-generate";

// Adapters are constructed here but never called, so this stays a no-network test.
const primary = {
  LLM_BASE_URL: "https://api.groq.com/openai/v1",
  LLM_API_KEY: "groq-key",
  LLM_MODEL: "openai/gpt-oss-120b",
};

describe("createLlmFromEnv", () => {
  it("builds the one configured provider and reports what it will use", () => {
    const { logger, logs } = fakeLogger();
    const stack = createLlmFromEnv(parseEnv({ ...primary, LLM_DAILY_REQUEST_BUDGET: "1000" }), logger);

    expect(stack.activeModel()).toBe("openai/gpt-oss-120b");
    expect(stack.dailyRequestBudget).toBe(1000);
    expect(logs.find((l) => l.msg === "llm selected")?.context).toMatchObject({
      model: "openai/gpt-oss-120b",
      models: ["openai/gpt-oss-120b"],
      writerModels: null,
    });
  });

  it("reports no budget at all when any member's ceiling is unknown", () => {
    // Half the real budget is a worse warning than none: it would fire on builds that comfortably fit.
    const stack = createLlmFromEnv(parseEnv({ ...primary, LLM_MODELS: "second-model" }));
    expect(stack.dailyRequestBudget).toBeUndefined();
  });

  describe("model pool", () => {
    it("namespaces the cache by the MODEL when no pool is configured, invalidating nothing", () => {
      // The guarantee that adding cacheNamespace() did not change any existing key material.
      const stack = createLlmFromEnv(parseEnv(primary));
      expect(stack.cacheNamespace()).toBe("openai/gpt-oss-120b");
      expect(stack.cacheNamespace()).toBe(stack.activeModel());
    });

    it("wires a pool when the profile lists extra models, keeping the lead as activeModel", () => {
      const { logger, logs } = fakeLogger();
      const stack = createLlmFromEnv(
        parseEnv({ ...primary, LLM_MODELS: "second-model,third-model" }),
        logger,
      );
      expect(stack.activeModel()).toBe("openai/gpt-oss-120b");
      // A pool label, NOT a model id: it must not move when a member answers.
      expect(stack.cacheNamespace()).toMatch(/^pool:[0-9a-f]{16}$/);
      expect(logs.find((l) => l.msg === "llm selected")?.context).toMatchObject({
        rotation: "round-robin",
        models: ["openai/gpt-oss-120b", "second-model", "third-model"],
      });
    });

    it("shares one instance with the writer unless LLM_WRITER_MODELS says otherwise", () => {
      const stack = createLlmFromEnv(parseEnv({ ...primary, LLM_MODELS: "second-model" }));
      // Identity, not equality: one pool means one limiter and one set of adapters (C92).
      expect(stack.writerLlm).toBe(stack.llm);
    });

    it("gives the writer its own pool when LLM_WRITER_MODELS is set, led by that list", () => {
      const { logger, logs } = fakeLogger();
      const stack = createLlmFromEnv(
        parseEnv({ ...primary, LLM_MODELS: "second-model", LLM_WRITER_MODELS: "writer-a,writer-b" }),
        logger,
      );
      expect(stack.writerLlm).not.toBe(stack.llm);
      // The writer list is NOT headed by LLM_MODEL: its whole purpose is to exclude models that can
      // expand but cannot write.
      expect(stack.writerLlm.activeModel()).toBe("writer-a");
      expect(stack.llm.activeModel()).toBe("openai/gpt-oss-120b");
      expect(logs.find((l) => l.msg === "llm selected")?.context).toMatchObject({
        writerModels: ["writer-a", "writer-b"],
      });
    });

    it("keeps a single model when rotation is off, even with LLM_MODELS set", () => {
      const stack = createLlmFromEnv(parseEnv({ ...primary, LLM_MODELS: "b", LLM_MODEL_ROTATION: "off" }));
      expect(stack.cacheNamespace()).toBe("openai/gpt-oss-120b");
    });

    it("sums every pool member's budget", () => {
      const stack = createLlmFromEnv(
        parseEnv({ ...primary, LLM_DAILY_REQUEST_BUDGET: "250", LLM_MODELS: "a=1000,b=1000" }),
      );
      // One account, three models: 250 + 1000 + 1000. This IS the run's daily ceiling now (C93).
      expect(stack.dailyRequestBudget).toBe(2250);
    });
  });
});

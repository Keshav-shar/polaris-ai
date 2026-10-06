import { describe, expect, it } from "vitest";
import { MAX_NODES_PER_RUN, WORKER } from "../../../src/config/constants";
import { EnvError, isLlmConfigured, parseEnv, requireLlmEnv } from "../../../src/config/env";

const llm = {
  LLM_BASE_URL: "https://api.example.test/v1",
  LLM_API_KEY: "test-key",
  LLM_MODEL: "test-model",
};

describe("parseEnv", () => {
  it("applies defaults to an empty environment", () => {
    const env = parseEnv({});
    expect(env).toMatchObject({
      API_PORT: 4000,
      CORS_ORIGIN: "http://localhost:3000",
      LOG_LEVEL: "info",
      QUEUE_MODE: "memory",
      LLM_JSON_MODE: true,
      LLM_MAX_CONCURRENCY: 4,
      SEARCH_PROVIDER: "wikipedia",
    });
    expect(env.LLM_API_KEY).toBeUndefined();
  });

  it("treats empty strings as unset", () => {
    const env = parseEnv({ LLM_API_KEY: "", API_PORT: "", LLM_BASE_URL: "" });
    expect(env.LLM_API_KEY).toBeUndefined();
    expect(env.LLM_BASE_URL).toBeUndefined();
    expect(env.API_PORT).toBe(4000);
  });

  it("coerces numbers and booleans", () => {
    const env = parseEnv({ API_PORT: "5050", LLM_JSON_MODE: "false", LLM_MAX_CONCURRENCY: "2" });
    expect(env).toMatchObject({ API_PORT: 5050, LLM_JSON_MODE: false, LLM_MAX_CONCURRENCY: 2 });
  });

  it("requires a Tavily key when Tavily is the search provider", () => {
    expect(() => parseEnv({ SEARCH_PROVIDER: "tavily" })).toThrow(/TAVILY_API_KEY/);
    expect(parseEnv({ SEARCH_PROVIDER: "tavily", TAVILY_API_KEY: "t" }).SEARCH_PROVIDER).toBe("tavily");
  });

  it("fails readably on invalid values without echoing them", () => {
    let error: unknown;
    try {
      parseEnv({ API_PORT: "not-a-port-9x7", LLM_BASE_URL: "secret-looking-value" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(EnvError);
    const message = (error as EnvError).message;
    expect(message).toMatch(/API_PORT/);
    expect(message).toMatch(/LLM_BASE_URL/);
    expect(message).not.toContain("not-a-port-9x7");
    expect(message).not.toContain("secret-looking-value");
  });
});

describe("LLM configuration", () => {
  it("is not configured without all three values", () => {
    expect(isLlmConfigured(parseEnv({}))).toBe(false);
    expect(isLlmConfigured(parseEnv({ ...llm, LLM_MODEL: "" }))).toBe(false);
    expect(isLlmConfigured(parseEnv(llm))).toBe(true);
  });

  it("requireLlmEnv names the missing variables", () => {
    expect(() => requireLlmEnv(parseEnv({ LLM_API_KEY: "k" }))).toThrow(/LLM_BASE_URL, LLM_MODEL/);
  });

  it("requireLlmEnv returns the typed config", () => {
    expect(requireLlmEnv(parseEnv(llm))).toEqual({
      baseUrl: llm.LLM_BASE_URL,
      apiKey: llm.LLM_API_KEY,
      model: llm.LLM_MODEL,
      // Always a pool, even with no LLM_MODELS: the lead alone, so every downstream reader has one shape.
      models: [{ id: llm.LLM_MODEL, dailyRequestBudget: undefined }],
      rotation: "round-robin",
      jsonMode: true,
      maxConcurrency: 4,
      temperature: undefined,
      seedMode: "off",
    });
    expect(requireLlmEnv(parseEnv({ ...llm, LLM_TEMPERATURE: "0.2", LLM_SEED_MODE: "node" }))).toMatchObject({
      temperature: 0.2,
      seedMode: "node",
    });
  });

  describe("model pool (LLM_MODELS)", () => {
    it("puts the lead first and keeps the configured order", () => {
      const env = requireLlmEnv(parseEnv({ ...llm, LLM_MODELS: "b-model,c-model" }));
      expect(env.models.map((m) => m.id)).toEqual([llm.LLM_MODEL, "b-model", "c-model"]);
      expect(env.model).toBe(env.models[0].id);
    });

    it("parses an entry's own requests/day and tolerates surrounding whitespace", () => {
      const env = requireLlmEnv(parseEnv({ ...llm, LLM_MODELS: " b-model=1000 , c-model " }));
      expect(env.models).toEqual([
        { id: llm.LLM_MODEL, dailyRequestBudget: undefined },
        { id: "b-model", dailyRequestBudget: 1000 },
        { id: "c-model", dailyRequestBudget: undefined },
      ]);
    });

    it("keeps a model id containing '=' by splitting on the LAST one", () => {
      const env = requireLlmEnv(parseEnv({ ...llm, LLM_MODELS: "vendor/a=b=250" }));
      expect(env.models[1]).toEqual({ id: "vendor/a=b", dailyRequestBudget: 250 });
    });

    it("dedupes a repeat of the lead or of another member, first occurrence winning", () => {
      const env = requireLlmEnv(parseEnv({ ...llm, LLM_MODELS: `b,${llm.LLM_MODEL},b` }));
      expect(env.models.map((m) => m.id)).toEqual([llm.LLM_MODEL, "b"]);
    });

    it("rejects a malformed budget rather than silently disabling proactive retirement", () => {
      expect(() => requireLlmEnv(parseEnv({ ...llm, LLM_MODELS: "b=nope" }))).toThrow(/LLM_MODELS/);
      expect(() => requireLlmEnv(parseEnv({ ...llm, LLM_MODELS: "b=0" }))).toThrow(EnvError);
    });

    it("sums every member's budget, and reports undefined when ANY member's is unknown", () => {
      const withAll = requireLlmEnv(
        parseEnv({ ...llm, LLM_DAILY_REQUEST_BUDGET: "250", LLM_MODELS: "b=1000,c=1000" }),
      );
      expect(withAll.dailyRequestBudget).toBe(2250);
      const withGap = requireLlmEnv(
        parseEnv({ ...llm, LLM_DAILY_REQUEST_BUDGET: "250", LLM_MODELS: "b=1000,c" }),
      );
      expect(withGap.dailyRequestBudget).toBeUndefined();
    });

    it("leaves writerModels undefined unless LLM_WRITER_MODELS is set, and never adds the lead to it", () => {
      expect(requireLlmEnv(parseEnv(llm)).writerModels).toBeUndefined();
      const withWriter = requireLlmEnv(parseEnv({ ...llm, LLM_WRITER_MODELS: "big-a=500,big-b" }));
      // The construction lead is deliberately absent: the list exists to EXCLUDE models that expand
      // fine but cannot emit a scope-sized article (C92).
      expect(withWriter.writerModels).toEqual([
        { id: "big-a", dailyRequestBudget: 500 },
        { id: "big-b", dailyRequestBudget: undefined },
      ]);
      expect(withWriter.models[0]!.id).toBe(llm.LLM_MODEL);
    });

    it("defaults rotation to round-robin and rejects an unknown policy", () => {
      // The binding limit on Groq is per-minute and per-model. throttle only lifts it AFTER a 429;
      // round-robin spreads the load before one is hit, so it is the default (C92).
      expect(requireLlmEnv(parseEnv(llm)).rotation).toBe("round-robin");
      expect(requireLlmEnv(parseEnv({ ...llm, LLM_MODEL_ROTATION: "throttle" })).rotation).toBe("throttle");
      expect(requireLlmEnv(parseEnv({ ...llm, LLM_MODEL_ROTATION: "exhaustion" })).rotation).toBe("exhaustion");
      expect(() => parseEnv({ ...llm, LLM_MODEL_ROTATION: "sometimes" })).toThrow(EnvError);
    });
  });

  it("refuses to start when .env still sets a variable removed with the second provider", () => {
    // THE guard that makes the C93 migration safe: the live Groq key used to sit in
    // LLM_FALLBACK_API_KEY, so silently ignoring these would start the process against the empty
    // LLM_* names - or against a leftover key for a provider that is no longer wanted.
    expect(() => parseEnv({ ...llm, LLM_PROVIDER: "fallback" })).toThrow(EnvError);
    expect(() => parseEnv({ ...llm, LLM_FALLBACK_API_KEY: "gsk-live" })).toThrow(
      /LLM_FALLBACK_API_KEY: move its value to LLM_API_KEY/,
    );
    expect(() => parseEnv({ ...llm, LLM_FALLBACK_MODELS: "a,b" })).toThrow(/move its value to LLM_MODELS/);
    // An emptied-out line carries nothing to migrate, so it is not worth refusing to boot over.
    expect(() => parseEnv({ ...llm, LLM_FALLBACK_API_KEY: "", LLM_PROVIDER: "" })).not.toThrow();
  });

  it("names the missing variables when the LLM is not configured", () => {
    expect(() => requireLlmEnv(parseEnv({ LLM_API_KEY: "k" }))).toThrow(
      /LLM is not configured. Set LLM_BASE_URL, LLM_MODEL/,
    );
  });

  it("defaults the worker concurrency to WORKER.EXPAND_CONCURRENCY", () => {
    expect(parseEnv({}).WORKER_EXPAND_CONCURRENCY).toBe(WORKER.EXPAND_CONCURRENCY);
    expect(parseEnv({ WORKER_EXPAND_CONCURRENCY: "5" }).WORKER_EXPAND_CONCURRENCY).toBe(5);
    expect(() => parseEnv({ WORKER_EXPAND_CONCURRENCY: "0" })).toThrow(EnvError);
  });

  it("leaves LLM_DAILY_REQUEST_BUDGET unset unless the provider's limit is known", () => {
    // Unset means "no known ceiling", not "unlimited": it only ever drives a warning, so an absent
    // value must never be read as 0 and turn every build into a warning.
    expect(parseEnv({}).LLM_DAILY_REQUEST_BUDGET).toBeUndefined();
    expect(parseEnv({ LLM_DAILY_REQUEST_BUDGET: "" }).LLM_DAILY_REQUEST_BUDGET).toBeUndefined();
    expect(parseEnv({ LLM_DAILY_REQUEST_BUDGET: "20" }).LLM_DAILY_REQUEST_BUDGET).toBe(20);
    expect(() => parseEnv({ LLM_DAILY_REQUEST_BUDGET: "0" })).toThrow(EnvError);
    expect(() => parseEnv({ LLM_DAILY_REQUEST_BUDGET: "many" })).toThrow(EnvError);
  });

  it("gives the lead's budget to the lead, and sums the pool", () => {
    // One account now (C93), so the only budget question left is how the members add up.
    const env = parseEnv({ ...llm, LLM_DAILY_REQUEST_BUDGET: "1000", LLM_MODELS: "b=1000,c=1000" });
    expect(requireLlmEnv(env).dailyRequestBudget).toBe(3000);
    expect(requireLlmEnv(parseEnv({ ...llm, LLM_DAILY_REQUEST_BUDGET: "1000" })).dailyRequestBudget).toBe(1000);
  });

  it("defaults MAX_NODES_PER_RUN to the constant and rejects a meaningless cap", () => {
    expect(parseEnv({}).MAX_NODES_PER_RUN).toBe(MAX_NODES_PER_RUN);
    expect(parseEnv({ MAX_NODES_PER_RUN: "10" }).MAX_NODES_PER_RUN).toBe(10);
    expect(() => parseEnv({ MAX_NODES_PER_RUN: "0" })).toThrow(EnvError);
  });

  it("leaves LLM_TEMPERATURE unset by default and rejects values outside 0-2", () => {
    expect(parseEnv({}).LLM_TEMPERATURE).toBeUndefined();
    expect(parseEnv({ LLM_TEMPERATURE: "" }).LLM_TEMPERATURE).toBeUndefined();
    expect(parseEnv({ LLM_TEMPERATURE: "0" }).LLM_TEMPERATURE).toBe(0);
    expect(() => parseEnv({ LLM_TEMPERATURE: "3" })).toThrow(EnvError);
    expect(() => parseEnv({ LLM_SEED_MODE: "always" })).toThrow(EnvError);
    expect(parseEnv({}).LLM_SEED_MODE).toBe("off");
  });
});

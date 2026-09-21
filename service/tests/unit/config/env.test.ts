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
      provider: "primary",
      baseUrl: llm.LLM_BASE_URL,
      apiKey: llm.LLM_API_KEY,
      model: llm.LLM_MODEL,
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

  it("selects the fallback profile and requires only its variables", () => {
    const fallback = {
      LLM_FALLBACK_BASE_URL: "https://api.groq.com/openai/v1",
      LLM_FALLBACK_API_KEY: "fk",
      LLM_FALLBACK_MODEL: "llama-3.3-70b-versatile",
    };
    // The inactive profile is never required: a Gemini-only .env still parses.
    expect(parseEnv({ ...llm }).LLM_PROVIDER).toBe("primary");
    expect(isLlmConfigured(parseEnv({ ...fallback, LLM_PROVIDER: "fallback" }))).toBe(true);
    expect(requireLlmEnv(parseEnv({ ...llm, ...fallback, LLM_PROVIDER: "fallback" }))).toMatchObject({
      provider: "fallback",
      baseUrl: fallback.LLM_FALLBACK_BASE_URL,
      model: fallback.LLM_FALLBACK_MODEL,
    });
  });

  it("rejects LLM_PROVIDER=fallback without the fallback variables", () => {
    expect(() => parseEnv({ ...llm, LLM_PROVIDER: "fallback" })).toThrow(EnvError);
    expect(() => parseEnv({ ...llm, LLM_PROVIDER: "fallback" })).toThrow(/LLM_FALLBACK_BASE_URL/);
  });

  it("names the ACTIVE profile's variables when they are missing", () => {
    expect(() => requireLlmEnv(parseEnv({ LLM_API_KEY: "k" }))).toThrow(/LLM_PROVIDER=primary/);
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

  it("gives each profile its OWN daily budget", () => {
    // Gemini's 20/day and Groq's ceiling differ by orders of magnitude; one shared number would warn
    // against the wrong one the moment LLM_PROVIDER changed (docs/conflicts.md C58).
    const env = parseEnv({
      ...llm,
      LLM_DAILY_REQUEST_BUDGET: "20",
      LLM_FALLBACK_BASE_URL: "https://api.groq.com/openai/v1",
      LLM_FALLBACK_API_KEY: "groq-key",
      LLM_FALLBACK_MODEL: "groq-model",
      LLM_FALLBACK_DAILY_REQUEST_BUDGET: "1000",
    });
    expect(requireLlmEnv(env, "primary").dailyRequestBudget).toBe(20);
    expect(requireLlmEnv(env, "fallback").dailyRequestBudget).toBe(1000);
    // Defaults to the profile LLM_PROVIDER selects.
    expect(requireLlmEnv(env).dailyRequestBudget).toBe(20);
  });

  it("can inspect the INACTIVE profile, which is what failover needs", () => {
    const env = parseEnv({
      ...llm,
      LLM_FALLBACK_BASE_URL: "https://api.groq.com/openai/v1",
      LLM_FALLBACK_API_KEY: "groq-key",
      LLM_FALLBACK_MODEL: "groq-model",
    });
    expect(env.LLM_PROVIDER).toBe("primary");
    expect(isLlmConfigured(env, "fallback")).toBe(true);
    expect(requireLlmEnv(env, "fallback").model).toBe("groq-model");
    // And reports the profile it was asked about, not the globally active one.
    expect(requireLlmEnv(env, "fallback").provider).toBe("fallback");
  });

  it("names the profile it was asked about when that profile is incomplete", () => {
    expect(() => requireLlmEnv(parseEnv({ ...llm }), "fallback")).toThrow(/LLM_PROVIDER=fallback/);
    expect(() => requireLlmEnv(parseEnv({ ...llm }), "fallback")).toThrow(/LLM_FALLBACK_BASE_URL/);
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

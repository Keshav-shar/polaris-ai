import { describe, expect, it } from "vitest";
import { createContainer } from "../../../src/composition/container";
import { EnvError, parseEnv } from "../../../src/config/env";
import { createLogger } from "../../../src/shared/logger";

const logger = createLogger({ write: () => {} });

// No network happens here: the LLM adapter is constructed, never called.
const configured = {
  LLM_BASE_URL: "https://example.test/v1",
  LLM_API_KEY: "test-key",
  LLM_MODEL: "test-model",
};

const env = (overrides: Record<string, string | undefined> = {}) => parseEnv({ ...configured, ...overrides });

describe("api container", () => {
  it("does not touch the LLM configuration until a request needs it", () => {
    const unconfigured = parseEnv({});
    // Building the stack at boot would take the process down with an EnvError, leaving nothing able to
    // answer the 503 that explains it (docs/conflicts.md C64).
    expect(() => createContainer(unconfigured, logger)).not.toThrow();
    expect(createContainer(unconfigured, logger).llmConfigured).toBe(false);
  });

  it("throws EnvError naming the missing variables when a request arrives", () => {
    const container = createContainer(parseEnv({}), logger);
    expect(() => container.startTreeBuild()).toThrow(EnvError);
    expect(() => container.startTreeBuild()).toThrow(/LLM_API_KEY/);
  });

  it("builds the stack once and serves both use-cases from it", () => {
    const container = createContainer(env(), logger);
    expect(container.llmConfigured).toBe(true);
    // Same instances: a second stack would mean a second queue, and a run started on one would be
    // invisible to the other.
    expect(container.startTreeBuild()).toBe(container.startTreeBuild());
    expect(container.getTree()).toBe(container.getTree());
  });

  it("refuses QUEUE_MODE=sqs with a 503-shaped error until Phase 13", () => {
    const container = createContainer(env({ QUEUE_MODE: "sqs" }), logger);
    expect(() => container.getTree()).toThrow(/Phase 13/);
  });

  it("shuts down cleanly whether or not a stack was ever built", async () => {
    await expect(createContainer(parseEnv({}), logger).shutdown()).resolves.toBeUndefined();

    const container = createContainer(env(), logger);
    container.startTreeBuild();
    await expect(container.shutdown()).resolves.toBeUndefined();
  });
});

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

  // Phase 13: Express under QUEUE_MODE=sqs only kicks off and reads; the Lambdas build (A12).
  const sqs = {
    QUEUE_MODE: "sqs",
    AWS_REGION: "eu-west-1",
    NODES_TABLE_NAME: "PolarisNodes",
    NODE_EXPAND_QUEUE_URL: "https://sqs.eu-west-1.amazonaws.com/000000000000/polaris-node-expand",
    ARTICLE_WRITE_QUEUE_URL: "https://sqs.eu-west-1.amazonaws.com/000000000000/polaris-article-write",
  };

  it("refuses QUEUE_MODE=sqs without its queues and table, naming each", () => {
    expect(() => parseEnv({ QUEUE_MODE: "sqs" })).toThrow(/NODE_EXPAND_QUEUE_URL/);
    expect(() => parseEnv({ QUEUE_MODE: "sqs" })).toThrow(/NODES_TABLE_NAME/);
  });

  it("under QUEUE_MODE=sqs needs no LLM env, builds no local worker, and serves the read path", async () => {
    const container = createContainer(parseEnv(sqs), logger);
    expect(container.llmConfigured).toBe(true);
    expect(container.startTreeBuild()).toBe(container.startTreeBuild());
    expect(container.getTree()).toBeDefined();
    // Memory storage: an unknown run is a 404, answered without touching AWS.
    await expect(container.getTree().execute("11111111-1111-4111-8111-111111111111")).rejects.toThrow(/was not found/);
    await expect(container.shutdown()).resolves.toBeUndefined();
  });

  it("shuts down cleanly whether or not a stack was ever built", async () => {
    await expect(createContainer(parseEnv({}), logger).shutdown()).resolves.toBeUndefined();

    const container = createContainer(env(), logger);
    container.startTreeBuild();
    await expect(container.shutdown()).resolves.toBeUndefined();
  });
});

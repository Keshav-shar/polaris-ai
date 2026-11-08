import type { SQSEvent, SQSRecord } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { rootConstructMessage, toArticleMessage } from "../../../../src/application/tree/messages";
import { QUEUE } from "../../../../src/config/constants";
import { ArticleLeaseHeldError } from "../../../../src/domain/errors/article-lease-held.error";
import { QuotaExhaustedError } from "../../../../src/domain/errors/quota-exhausted.error";
import { TransportUnavailableError } from "../../../../src/domain/errors/transport-unavailable.error";
import type { NodeMessage } from "../../../../src/domain/schemas/queue-message.schema";
import { createDeadLetterHandler } from "../../../../src/interfaces/workers/queue-tail-handlers";
import { createSqsHandler, type Delivery, type SqsWorkerDeps } from "../../../../src/interfaces/workers/sqs-handler";
import { fakeLogger } from "../../../fixtures/fake-generate";

const runId = "11111111-1111-4111-8111-111111111111";
const construct = rootConstructMessage(runId, { topic: "Unix", maxDepth: 2, request: "teach me unix" });
const article = toArticleMessage(construct);

function record(message: unknown, attributes: Record<string, string> = {}, messageId = "msg-1"): SQSRecord {
  return {
    messageId,
    receiptHandle: "r",
    body: typeof message === "string" ? message : JSON.stringify(message),
    attributes: {} as SQSRecord["attributes"],
    messageAttributes: Object.fromEntries(
      Object.entries(attributes).map(([k, v]) => [k, { stringValue: v, dataType: "String" }]),
    ) as SQSRecord["messageAttributes"],
    md5OfBody: "",
    eventSource: "aws:sqs",
    eventSourceARN: "arn",
    awsRegion: "eu-west-1",
  };
}
const event = (...records: SQSRecord[]): SQSEvent => ({ Records: records });

function setup(handle: (m: NodeMessage, d: Delivery) => Promise<void>, overrides: Partial<SqsWorkerDeps> = {}) {
  const requeued: { message: NodeMessage; options: { delayMs: number; stallCount: number; claimant: string } }[] = [];
  const errors: { nodeId: string; reason: string }[] = [];
  const halted: string[] = [];
  const deps: SqsWorkerDeps = {
    pass: "construct",
    handle,
    runState: { get: async () => undefined },
    nodeState: { recordError: async (nodeId, reason) => void errors.push({ nodeId, reason }) },
    haltRun: { execute: async (id) => void halted.push(id) },
    requeueFor: () => ({ sendDelayed: async (message, options) => void requeued.push({ message, options }) }),
    describeFailure: (error) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error)),
    logger: fakeLogger().logger,
    now: () => 42,
    ...overrides,
  };
  return { handler: createSqsHandler(async () => deps), requeued, errors, halted };
}

describe("SQS handler policy (Phase 13, mirrors local-queue-worker.ts)", () => {
  it("success: nothing reported, the delivery carries the message id as claimant", async () => {
    const seen: Delivery[] = [];
    const { handler } = setup(async (_m, d) => void seen.push(d));
    await expect(handler(event(record(construct)))).resolves.toEqual({ batchItemFailures: [] });
    expect(seen).toEqual([{ claimant: "msg-1", nowMs: 42 }]);
  });

  it("A16: a halted run's message is dropped without running the handler", async () => {
    let ran = false;
    const { handler } = setup(async () => void (ran = true), { runState: { get: async () => ({ runId, haltedAt: 1 } as never) } });
    await expect(handler(event(record(construct)))).resolves.toEqual({ batchItemFailures: [] });
    expect(ran).toBe(false);
  });

  it("A16: a daily quota halts the run and acknowledges the message", async () => {
    const { handler, halted, errors } = setup(async () => {
      throw new QuotaExhaustedError("model-a");
    });
    await expect(handler(event(record(construct)))).resolves.toEqual({ batchItemFailures: [] });
    expect(halted).toEqual([runId]);
    expect(errors).toEqual([]);
  });

  it("A15: a transport fault re-sends a delayed copy, uncounted, keeping the claimant", async () => {
    const { handler, requeued } = setup(async () => {
      throw new TransportUnavailableError("the LLM provider", "ECONNRESET");
    });
    const result = await handler(event(record(construct, { stallCount: "1", claimant: "original" }, "copy-2")));
    expect(result.batchItemFailures).toEqual([]);
    expect(requeued[0]?.options).toEqual({ delayMs: QUEUE.STALL_DELAY_MS, stallCount: 2, claimant: "original" });
  });

  it("A15: past STALL_MAX_RELEASES a stall becomes a counted failure with its reason recorded", async () => {
    const { handler, requeued, errors } = setup(async () => {
      throw new TransportUnavailableError("the LLM provider", "ECONNRESET");
    });
    const result = await handler(event(record(construct, { stallCount: String(QUEUE.STALL_MAX_RELEASES) })));
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
    expect(requeued).toEqual([]);
    expect(errors[0]?.nodeId).toBe(construct.nodeId);
  });

  it("A18: a held lease is a stall, waiting at least until the lease ends", async () => {
    const { handler, requeued } = setup(
      async () => {
        throw new ArticleLeaseHeldError(article.nodeId, 90_000);
      },
      { pass: "article" },
    );
    await expect(handler(event(record(article)))).resolves.toEqual({ batchItemFailures: [] });
    expect(requeued[0]?.options.delayMs).toBe(90_000);
  });

  it("A17: any other error is recorded on the node, then reported so SQS redelivers", async () => {
    const { handler, errors } = setup(async () => {
      throw new Error("boom");
    });
    await expect(handler(event(record(construct)))).resolves.toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
    expect(errors).toEqual([{ nodeId: construct.nodeId, reason: "Error: boom" }]);
  });

  it("a malformed body or a message for the other pass is reported, never run", async () => {
    let ran = false;
    const { handler } = setup(async () => void (ran = true));
    const result = await handler(event(record("not json", {}, "a"), record(article, {}, "b")));
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "a" }, { itemIdentifier: "b" }]);
    expect(ran).toBe(false);
  });
});

describe("dead-letter handler (A17)", () => {
  it("hands the recorded reason to the use-case", async () => {
    const calls: [NodeMessage, unknown][] = [];
    const handler = createDeadLetterHandler(async () => ({
      handleDeadLetter: { execute: async (m, e) => void calls.push([m, e]) },
      nodeState: { lastError: async () => "BadRequestError: 400 truncated" },
      logger: fakeLogger().logger,
    }));
    await expect(handler(event(record(article)))).resolves.toEqual({ batchItemFailures: [] });
    expect(calls[0]?.[1]).toBe("BadRequestError: 400 truncated");
    expect(calls[0]?.[0].nodeId).toBe(article.nodeId);
  });
});

import type { SQSClient } from "@aws-sdk/client-sqs";
import { describe, expect, it } from "vitest";
import { rootConstructMessage } from "../../../../src/application/tree/messages";
import { createSqsNodeQueue } from "../../../../src/infrastructure/aws/sqs-node-queue.adapter";
import { fakeAwsClient } from "../../../fixtures/fake-aws";

const runId = "11111111-1111-4111-8111-111111111111";
const message = rootConstructMessage(runId, { topic: "Unix", maxDepth: 2, request: "teach me unix" });
const asSqs = (client: unknown) => client as SQSClient;

describe("SQS node queue (Phase 13)", () => {
  it("sends a batch in chunks of at most 10 entries", async () => {
    const { client, sent } = fakeAwsClient(() => ({ Successful: [], Failed: [] }));
    const queue = createSqsNodeQueue({ client: asSqs(client), queueUrl: "https://q/expand" });
    await queue.sendBatch(Array.from({ length: 23 }, () => message));
    expect(sent.map((s) => (s.input.Entries as unknown[]).length)).toEqual([10, 10, 3]);
  });

  it("throws when SQS reports a failed entry, so a child is never silently lost", async () => {
    const { client } = fakeAwsClient(() => ({ Failed: [{ Id: "0", Code: "InternalError", SenderFault: false }] }));
    const queue = createSqsNodeQueue({ client: asSqs(client), queueUrl: "https://q/expand" });
    await expect(queue.sendBatch([message])).rejects.toThrow(/InternalError/);
  });

  it("A24: promote copies to the priority queue when there is one, and does nothing without", async () => {
    const { client, sent } = fakeAwsClient(() => ({}));
    const article = createSqsNodeQueue({ client: asSqs(client), queueUrl: "https://q/article", priorityQueueUrl: "https://q/priority" });
    await expect(article.promote(message)).resolves.toBe("promoted");
    expect(sent[0]?.input.QueueUrl).toBe("https://q/priority");
    expect(JSON.parse(String(sent[0]?.input.MessageBody))).toMatchObject({ boost: true, nodeId: message.nodeId });

    const construct = createSqsNodeQueue({ client: asSqs(client), queueUrl: "https://q/expand" });
    await expect(construct.promote(message)).resolves.toBe("not-queued");
    expect(sent).toHaveLength(1);
  });

  it("A15: a stall re-send carries its delay (capped at 900 s), stall count and claimant", async () => {
    const { client, sent } = fakeAwsClient(() => ({}));
    const queue = createSqsNodeQueue({ client: asSqs(client), queueUrl: "https://q/article" });
    await queue.sendDelayed(message, { delayMs: 15_000, stallCount: 2, claimant: "msg-1" });
    await queue.sendDelayed(message, { delayMs: 3_600_000, stallCount: 3, claimant: "msg-1" });
    expect(sent[0]?.input).toMatchObject({
      DelaySeconds: 15,
      MessageAttributes: {
        stallCount: { DataType: "Number", StringValue: "2" },
        claimant: { DataType: "String", StringValue: "msg-1" },
      },
    });
    expect(sent[1]?.input.DelaySeconds).toBe(900);
  });
});

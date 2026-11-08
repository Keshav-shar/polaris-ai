import { SendMessageBatchCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { NodeQueuePort, StallRequeuePort } from "../../application/ports/node-queue.port";
import { QUEUE } from "../../config/constants";
import type { NodeMessage } from "../../domain/schemas/queue-message.schema";

// SQS caps a message delay at 15 minutes.
const MAX_DELAY_SECONDS = 900;

export type SqsConfig = { region: string; endpoint?: string | undefined };

export function createSqsClient({ region, endpoint }: SqsConfig): SQSClient {
  return new SQSClient({ region, ...(endpoint === undefined ? {} : { endpoint }) });
}

// Message attributes the consumer reads back (sqs-handler.ts). Names only here, so producer and consumer agree.
export const SQS_ATTRIBUTES = { STALL_COUNT: "stallCount", CLAIMANT: "claimant" } as const;

// NodeQueuePort on one SQS Standard queue (Phase 13). `priorityQueueUrl` is the article pass's priority queue
// (`polaris-article-write-priority`): SQS cannot reorder, so a boost SENDS a copy there (A24) and the article lease
// makes the duplicate harmless (A18). Without one - the construct queue - promote sends nothing: a copied construct
// message could make two expand calls, so a not-yet-expanded node is boosted through markBoosted alone.
export function createSqsNodeQueue({
  client,
  queueUrl,
  priorityQueueUrl,
}: {
  client: SQSClient;
  queueUrl: string;
  priorityQueueUrl?: string | undefined;
}): NodeQueuePort & StallRequeuePort {
  const body = (message: NodeMessage): string => JSON.stringify(message);

  return {
    async send(message) {
      await client.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body(message) }));
    },

    // SendMessageBatch takes at most QUEUE.SEND_BATCH_MAX entries, and reports per-entry failures instead of throwing:
    // a partly failed batch must throw here, or a child message would be silently lost.
    async sendBatch(messages) {
      for (let i = 0; i < messages.length; i += QUEUE.SEND_BATCH_MAX) {
        const chunk = messages.slice(i, i + QUEUE.SEND_BATCH_MAX);
        const out = await client.send(
          new SendMessageBatchCommand({
            QueueUrl: queueUrl,
            Entries: chunk.map((message, index) => ({ Id: String(index), MessageBody: body(message) })),
          }),
        );
        const failed = out.Failed ?? [];
        if (failed.length > 0) {
          throw new Error(`SQS batch send failed for ${failed.length} of ${chunk.length} messages (${failed[0]?.Code ?? "?"})`);
        }
      }
    },

    async promote(message) {
      if (priorityQueueUrl === undefined) return "not-queued";
      await client.send(new SendMessageCommand({ QueueUrl: priorityQueueUrl, MessageBody: body({ ...message, boost: true }) }));
      return "promoted";
    },

    async sendDelayed(message, { delayMs, stallCount, claimant }) {
      await client.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: body(message),
          DelaySeconds: Math.min(MAX_DELAY_SECONDS, Math.max(0, Math.ceil(delayMs / 1000))),
          MessageAttributes: {
            [SQS_ATTRIBUTES.STALL_COUNT]: { DataType: "Number", StringValue: String(stallCount) },
            [SQS_ATTRIBUTES.CLAIMANT]: { DataType: "String", StringValue: claimant },
          },
        }),
      );
    },
  };
}

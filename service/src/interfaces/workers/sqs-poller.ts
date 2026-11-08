import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import type { Logger } from "../../shared/logger";

// The local stand-in for the Lambda event source mapping (C109): long-polls each queue, hands every message to the
// SAME handler a Lambda would run, and deletes it only when the handler did not report it failed. A failure is left
// to its visibility timeout, so ElasticMQ redelivers it and, after maxReceiveCount, moves it to the DLQ - exactly the
// AWS behaviour. Structural `sqs`, so this module imports no SDK.
export type PollTarget = { name: string; queueUrl: string; handler(event: SQSEvent): Promise<SQSBatchResponse> };

export type PollerSqs = {
  receive(queueUrl: string): Promise<SQSRecord[]>;
  delete(queueUrl: string, receiptHandle: string): Promise<void>;
};

export type SqsPoller = { stop(): Promise<void> };

export function startSqsPoller({
  targets,
  sqs,
  logger,
}: {
  targets: readonly PollTarget[];
  sqs: PollerSqs;
  logger: Pick<Logger, "error">;
}): SqsPoller {
  let running = true;
  const loop = async (target: PollTarget): Promise<void> => {
    while (running) {
      try {
        const records = await sqs.receive(target.queueUrl);
        if (records.length === 0) continue;
        const { batchItemFailures } = await target.handler({ Records: records });
        const failed = new Set(batchItemFailures.map((f) => f.itemIdentifier));
        for (const record of records) {
          if (!failed.has(record.messageId)) await sqs.delete(target.queueUrl, record.receiptHandle);
        }
      } catch (error) {
        // A Lambda that throws leaves its batch for redelivery; so does this. Never kill the loop over one message.
        logger.error("poller: handler threw", { queue: target.name, error });
      }
    }
  };
  const loops = targets.map(loop);
  return {
    async stop() {
      running = false;
      await Promise.all(loops);
    },
  };
}

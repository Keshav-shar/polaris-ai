import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type { InsightQueuePort } from "../../application/ports/insight.port";

// The learner-insight queue on SQS (`polaris-insight-refresh`, A21). Its own redrive gives the job the retries the
// in-process runner deliberately does not.
export function createSqsInsightQueue({ client, queueUrl }: { client: SQSClient; queueUrl: string }): InsightQueuePort {
  return {
    async send(message) {
      await client.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
    },
  };
}

// Shared by the local-parity scripts (C109): the emulators' endpoints, the resource names (the same as on AWS,
// docs/setup.md), and the idempotent setup that creates them on ElasticMQ + DynamoDB Local.
import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
  UpdateTimeToLiveCommand,
} from "@aws-sdk/client-dynamodb";
import {
  CreateQueueCommand,
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import type { SQSRecord } from "aws-lambda";
import type { PollerSqs } from "../src/interfaces/workers/sqs-poller";

export const LOCAL = {
  region: "us-east-1",
  sqsEndpoint: process.env.AWS_ENDPOINT_URL_SQS ?? "http://localhost:9324",
  dynamoEndpoint: process.env.AWS_ENDPOINT_URL_DYNAMODB ?? "http://localhost:8000",
  table: "PolarisNodes",
  // Short, so a failing message reaches its DLQ in ~30 s locally instead of 6 x the Lambda timeout.
  visibilityTimeoutSeconds: 10,
  maxReceiveCount: 3,
} as const;

// Each main queue and the DLQ its redrive policy points at (the priority queue shares the article DLQ).
export const QUEUES = [
  { name: "polaris-node-expand", dlq: "polaris-node-expand-dlq" },
  { name: "polaris-article-write", dlq: "polaris-article-write-dlq" },
  { name: "polaris-article-write-priority", dlq: "polaris-article-write-dlq" },
  { name: "polaris-insight-refresh", dlq: "polaris-insight-refresh-dlq" },
] as const;

export const queueUrl = (name: string): string => `${LOCAL.sqsEndpoint}/000000000000/${name}`;

// The SDK needs credentials even for the emulators; these are placeholders that only the emulators accept.
export function useLocalAws(): void {
  process.env.AWS_ENDPOINT_URL_SQS = LOCAL.sqsEndpoint;
  process.env.AWS_ENDPOINT_URL_DYNAMODB = LOCAL.dynamoEndpoint;
  process.env.AWS_ACCESS_KEY_ID ??= "local";
  process.env.AWS_SECRET_ACCESS_KEY ??= "local";
  process.env.AWS_REGION = LOCAL.region;
}

// The env a QUEUE_MODE=sqs process needs against the emulators.
export function localSqsEnv(): Record<string, string> {
  return {
    QUEUE_MODE: "sqs",
    AWS_REGION: LOCAL.region,
    NODES_TABLE_NAME: LOCAL.table,
    NODE_EXPAND_QUEUE_URL: queueUrl("polaris-node-expand"),
    ARTICLE_WRITE_QUEUE_URL: queueUrl("polaris-article-write"),
    ARTICLE_PRIORITY_QUEUE_URL: queueUrl("polaris-article-write-priority"),
    INSIGHT_QUEUE_URL: queueUrl("polaris-insight-refresh"),
  };
}

export async function ensureLocalAws(): Promise<void> {
  const dynamo = new DynamoDBClient({ region: LOCAL.region, endpoint: LOCAL.dynamoEndpoint });
  try {
    await dynamo.send(new DescribeTableCommand({ TableName: LOCAL.table }));
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) throw error;
    // The same shape as on AWS (D3): PK nodeId, provisioned 5/5, TTL on expiresAt.
    await dynamo.send(
      new CreateTableCommand({
        TableName: LOCAL.table,
        AttributeDefinitions: [{ AttributeName: "nodeId", AttributeType: "S" }],
        KeySchema: [{ AttributeName: "nodeId", KeyType: "HASH" }],
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      }),
    );
    await dynamo.send(
      new UpdateTimeToLiveCommand({
        TableName: LOCAL.table,
        TimeToLiveSpecification: { AttributeName: "expiresAt", Enabled: true },
      }),
    );
  }

  const sqs = new SQSClient({ region: LOCAL.region, endpoint: LOCAL.sqsEndpoint });
  for (const dlq of new Set(QUEUES.map((q) => q.dlq))) {
    await sqs.send(new CreateQueueCommand({ QueueName: dlq, Attributes: { MessageRetentionPeriod: "1209600" } }));
  }
  for (const { name, dlq } of QUEUES) {
    const arn = (
      await sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl(dlq), AttributeNames: ["QueueArn"] }))
    ).Attributes?.QueueArn;
    await sqs.send(
      new CreateQueueCommand({
        QueueName: name,
        Attributes: {
          VisibilityTimeout: String(LOCAL.visibilityTimeoutSeconds),
          RedrivePolicy: JSON.stringify({ deadLetterTargetArn: arn, maxReceiveCount: String(LOCAL.maxReceiveCount) }),
        },
      }),
    );
  }
}

// The poller's receive/delete over a real SQS client, mapping SQS messages to Lambda's record shape.
export function pollerSqs(client: SQSClient, waitSeconds = 2): PollerSqs {
  return {
    async receive(url) {
      const out = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: url,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: waitSeconds,
          MessageAttributeNames: ["All"],
          MessageSystemAttributeNames: ["All"],
        }),
      );
      return (out.Messages ?? []).map(
        (m): SQSRecord => ({
          messageId: m.MessageId ?? "",
          receiptHandle: m.ReceiptHandle ?? "",
          body: m.Body ?? "",
          attributes: (m.Attributes ?? {}) as unknown as SQSRecord["attributes"],
          messageAttributes: Object.fromEntries(
            Object.entries(m.MessageAttributes ?? {}).map(([k, v]) => [
              k,
              { stringValue: v.StringValue, dataType: v.DataType ?? "String" },
            ]),
          ) as SQSRecord["messageAttributes"],
          md5OfBody: m.MD5OfBody ?? "",
          eventSource: "aws:sqs",
          eventSourceARN: url,
          awsRegion: LOCAL.region,
        }),
      );
    },
    async delete(url, receiptHandle) {
      await client.send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: receiptHandle }));
    },
  };
}

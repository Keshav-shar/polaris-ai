import type { InsightQueuePort } from "../application/ports/insight.port";
import type { NodeQueuePort, StallRequeuePort } from "../application/ports/node-queue.port";
import type { NodeStatePort } from "../application/ports/node-state.port";
import { awsEnv, type Env } from "../config/env";
import type { NodeMessage } from "../domain/schemas/queue-message.schema";
import { createSqsClient, createSqsNodeQueue } from "../infrastructure/aws/sqs-node-queue.adapter";
import { createSqsInsightQueue } from "../infrastructure/aws/sqs-insight-queue.adapter";
import { createDynamoDedupStore } from "../infrastructure/dynamodb/dynamo-dedup.store";
import { createDynamoNodeStateStore } from "../infrastructure/dynamodb/dynamo-node-state.store";
import { createDynamoRateWindowStore } from "../infrastructure/dynamodb/dynamo-rate-window.store";
import { createDynamoRunStateStore } from "../infrastructure/dynamodb/dynamo-run-state.store";
import { createDynamoDocumentClient } from "../infrastructure/dynamodb/dynamo-shared";
import type { Logger } from "../shared/logger";
import type { BuildInfra } from "./build-stack";
import type { Storage } from "./storage";

// The SQS + DynamoDB half of the build path (Phase 13), the same BuildInfra the memory stack fills. Constructing it
// opens no connection: the SDK clients connect on their first call.
export type AwsInfra = BuildInfra & {
  // Where a stall re-send goes (A15): the queue the message came from.
  requeueFor(message: NodeMessage): StallRequeuePort;
};

// Express under QUEUE_MODE=sqs needs only what kickoff, the read path and boost touch (A12, A20): the two queues to
// send to and the node state for markBoosted. No run state - stats come from the rows (A19) - and no LLM.
export function createAwsKickoffInfra(env: Env, storage: Storage): {
  queue: NodeQueuePort;
  articleQueue: NodeQueuePort;
  nodeState: NodeStatePort;
} {
  const aws = awsEnv(env);
  const sqs = createSqsClient({ region: aws.region });
  const dynamo = createDynamoDocumentClient({ region: aws.region });
  return {
    queue: createSqsNodeQueue({ client: sqs, queueUrl: aws.expandQueueUrl }),
    articleQueue: createSqsNodeQueue({
      client: sqs,
      queueUrl: aws.articleQueueUrl,
      priorityQueueUrl: aws.articlePriorityQueueUrl,
    }),
    nodeState: createDynamoNodeStateStore({ client: dynamo, tableName: aws.tableName, drafts: storage.articleDrafts }),
  };
}

export function createAwsInfra(env: Env, storage: Storage, logger: Pick<Logger, "warn">): AwsInfra {
  const aws = awsEnv(env);
  const sqs = createSqsClient({ region: aws.region });
  const dynamo = createDynamoDocumentClient({ region: aws.region });
  const queue = createSqsNodeQueue({ client: sqs, queueUrl: aws.expandQueueUrl });
  const articleQueue = createSqsNodeQueue({
    client: sqs,
    queueUrl: aws.articleQueueUrl,
    priorityQueueUrl: aws.articlePriorityQueueUrl,
  });
  const insightQueue: InsightQueuePort =
    aws.insightQueueUrl === undefined
      ? {
          // Without the queue, learner insights are simply not refreshed; builds are unaffected.
          send: async (message) => logger.warn("INSIGHT_QUEUE_URL is not set: insight refresh skipped", { runId: message.runId }),
        }
      : createSqsInsightQueue({ client: sqs, queueUrl: aws.insightQueueUrl });
  return {
    queue,
    articleQueue,
    nodeState: createDynamoNodeStateStore({ client: dynamo, tableName: aws.tableName, drafts: storage.articleDrafts }),
    runState: createDynamoRunStateStore({ client: dynamo, tableName: aws.tableName, maxNodesPerRun: env.MAX_NODES_PER_RUN }),
    dedup: createDynamoDedupStore({ client: dynamo, tableName: aws.tableName }),
    rateWindow: createDynamoRateWindowStore({ client: dynamo, tableName: aws.tableName }),
    insightQueue: () => insightQueue,
    requeueFor: (message) => (message.pass === "construct" ? queue : articleQueue),
  };
}

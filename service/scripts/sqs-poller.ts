// The `worker` of local parity (C109): runs the Lambda handlers against ElasticMQ + DynamoDB Local, in place of the
// AWS event source mappings. Uses the process env (QUEUE_MODE=sqs, the queue URLs, Supabase for storage - the API is
// a separate process, so the stores must be shared, i.e. Postgres). Run: npm run worker:poll
import "dotenv/config";
import { SQSClient } from "@aws-sdk/client-sqs";
import { createLambdaHandlers, createWorkerContainer } from "../src/composition/worker-container";
import { startSqsPoller } from "../src/interfaces/workers/sqs-poller";
import { createLogger } from "../src/shared/logger";
import { LOCAL, pollerSqs, queueUrl } from "./local-aws";

const logger = createLogger();
const container = createWorkerContainer(process.env, { logger });
const handlers = createLambdaHandlers(() => container);
const poller = startSqsPoller({
  sqs: pollerSqs(new SQSClient({ region: process.env.AWS_REGION ?? LOCAL.region })),
  logger,
  targets: [
    { name: "expand", queueUrl: process.env.NODE_EXPAND_QUEUE_URL ?? queueUrl("polaris-node-expand"), handler: handlers.expandNode },
    { name: "article", queueUrl: process.env.ARTICLE_WRITE_QUEUE_URL ?? queueUrl("polaris-article-write"), handler: handlers.writeArticle },
    {
      name: "article-priority",
      queueUrl: process.env.ARTICLE_PRIORITY_QUEUE_URL ?? queueUrl("polaris-article-write-priority"),
      handler: handlers.writeArticle,
    },
    { name: "insight", queueUrl: process.env.INSIGHT_QUEUE_URL ?? queueUrl("polaris-insight-refresh"), handler: handlers.refreshInsight },
    { name: "expand-dlq", queueUrl: queueUrl("polaris-node-expand-dlq"), handler: handlers.handleDeadLetter },
    { name: "article-dlq", queueUrl: queueUrl("polaris-article-write-dlq"), handler: handlers.handleDeadLetter },
  ],
});
logger.info("sqs poller running");
const stop = (): void => {
  void poller.stop().then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { parseEnv } from "../config/env";
import { createDeadLetterHandler, createInsightHandler } from "../interfaces/workers/queue-tail-handlers";
import { createSqsHandler } from "../interfaces/workers/sqs-handler";
import { loadSsmParameters } from "../infrastructure/aws/ssm-secrets";
import { createLogger, type Logger } from "../shared/logger";
import { type AwsInfra, createAwsInfra } from "./aws-infra";
import { type CoreStack, createCoreStack } from "./build-stack";
import { createStorageFromEnv, type Storage } from "./storage";

export type WorkerContainer = { core: CoreStack; infra: AwsInfra; logger: Logger };

// The Lambdas' DI root (Phase 13): SSM secrets merged over the function's plain env vars, then the core stack over
// SQS + DynamoDB. `storage` is injectable so the single-process local smoke run can use memory stores and never
// touch a real database; on AWS it is Postgres, from SUPABASE_* (A10, A14).
export async function createWorkerContainer(
  source: Record<string, string | undefined>,
  options: { storage?: Storage; logger?: Logger } = {},
): Promise<WorkerContainer> {
  const logger = options.logger ?? createLogger();
  const prefix = source.SSM_PARAMETER_PREFIX;
  const region = source.AWS_REGION;
  // Read once per cold start (C108); SecureString values never reach a log line.
  const secrets = prefix !== undefined && prefix !== "" && region !== undefined ? await loadSsmParameters({ region, prefix }) : {};
  const env = parseEnv({ ...source, ...secrets });
  const storage = options.storage ?? createStorageFromEnv(env);
  const infra = createAwsInfra(env, storage, logger);
  return { core: createCoreStack(env, logger, { storage, infra }), infra, logger };
}

export type LambdaHandlers = {
  expandNode: (event: SQSEvent) => Promise<SQSBatchResponse>;
  writeArticle: (event: SQSEvent) => Promise<SQSBatchResponse>;
  handleDeadLetter: (event: SQSEvent) => Promise<SQSBatchResponse>;
  refreshInsight: (event: SQSEvent) => Promise<SQSBatchResponse>;
};

// The four queue consumers over one container. The Lambda entry points use getWorkerContainer; the local SQS poller
// and the AWS smoke run pass their own, so all three run exactly the same handlers.
export function createLambdaHandlers(load: () => Promise<WorkerContainer>): LambdaHandlers {
  const policy = (c: WorkerContainer) => ({
    runState: c.infra.runState,
    nodeState: c.infra.nodeState,
    haltRun: c.core.haltRun,
    requeueFor: c.infra.requeueFor,
    describeFailure: c.core.describeFailure,
    logger: c.logger,
  });
  return {
    expandNode: createSqsHandler(async () => {
      const c = await load();
      return { ...policy(c), pass: "construct", handle: (message) => c.core.expandNode.execute(message) };
    }),
    // Every article claim carries a lease, because on SQS a boost is a second copy (A18).
    writeArticle: createSqsHandler(async () => {
      const c = await load();
      return { ...policy(c), pass: "article", handle: (message, delivery) => c.core.writeArticle.execute(message, delivery) };
    }),
    handleDeadLetter: createDeadLetterHandler(async () => {
      const c = await load();
      return { handleDeadLetter: c.core.handleDeadLetter, nodeState: c.infra.nodeState, logger: c.logger };
    }),
    refreshInsight: createInsightHandler(async () => {
      const c = await load();
      return { refreshInsight: c.core.refreshInsight, logger: c.logger };
    }),
  };
}

let cached: Promise<WorkerContainer> | undefined;

// Memoized per warm container, and only on success: a cold start that failed (SSM throttled, a typo in the env)
// must not poison every later invocation of the same container.
export function getWorkerContainer(): Promise<WorkerContainer> {
  cached ??= createWorkerContainer(process.env).catch((error: unknown) => {
    cached = undefined;
    throw error;
  });
  return cached;
}

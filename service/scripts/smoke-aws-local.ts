// Phase 13 local Verify (C109): one process, the REAL build path over the emulators - kickoff through SQS, the
// Lambda handlers draining ElasticMQ, node/run state, dedup and the rate window in DynamoDB Local - with memory
// permanent stores, so nothing reaches a real database. Then a forced failure must travel redelivery -> DLQ ->
// handle-dead-letter and arrive with its recorded reason.
//
// Prereq: docker compose -f ../infra/local/compose.yaml up -d. Needs the LLM keys in service/.env.
// Run: npm run smoke:aws-local -- "<prompt>" [maxDepth=1]
import "dotenv/config";
import { SQSClient } from "@aws-sdk/client-sqs";
import { createAwsKickoffInfra } from "../src/composition/aws-infra";
import { createReadStack } from "../src/composition/read-stack";
import { createMemoryStorage } from "../src/composition/storage";
import { createLambdaHandlers, createWorkerContainer } from "../src/composition/worker-container";
import { parseEnv } from "../src/config/env";
import { startSqsPoller } from "../src/interfaces/workers/sqs-poller";
import { createLogger } from "../src/shared/logger";
import { randomUuid } from "../src/shared/ids";
import { ensureLocalAws, LOCAL, localSqsEnv, pollerSqs, queueUrl, useLocalAws } from "./local-aws";
import { failureDetail } from "./redact";

const TIMEOUT_MS = 15 * 60_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const [prompt = "Photosynthesis", depthArg = "1"] = process.argv.slice(2);
  const maxDepth = Number(depthArg);
  useLocalAws();
  await ensureLocalAws();

  // Memory storage on purpose: the run never touches Supabase even when service/.env configures it.
  const source = { ...process.env, ...localSqsEnv(), SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", LOG_LEVEL: "warn" };
  const env = parseEnv(source);
  const logger = createLogger({ level: "warn" });
  const redact = (text: string): string => failureDetail(env, text);
  const storage = createMemoryStorage();

  const api = createReadStack(env, logger, { storage, ...createAwsKickoffInfra(env, storage) });
  const container = await createWorkerContainer(source, { storage, logger });
  const handlers = createLambdaHandlers(async () => container);
  const sqs = new SQSClient({ region: LOCAL.region });
  const poller = startSqsPoller({
    sqs: pollerSqs(sqs, 1),
    logger,
    targets: [
      { name: "expand", queueUrl: queueUrl("polaris-node-expand"), handler: handlers.expandNode },
      { name: "article", queueUrl: queueUrl("polaris-article-write"), handler: handlers.writeArticle },
      { name: "article-priority", queueUrl: queueUrl("polaris-article-write-priority"), handler: handlers.writeArticle },
      { name: "insight", queueUrl: queueUrl("polaris-insight-refresh"), handler: handlers.refreshInsight },
      { name: "expand-dlq", queueUrl: queueUrl("polaris-node-expand-dlq"), handler: handlers.handleDeadLetter },
      { name: "article-dlq", queueUrl: queueUrl("polaris-article-write-dlq"), handler: handlers.handleDeadLetter },
    ],
  });

  try {
    // 1. A real build to `done`, through SQS + DynamoDB.
    const started = Date.now();
    const { runId } = await api.startTreeBuild.execute(prompt, { maxDepth });
    console.log(`run ${runId} started (maxDepth ${maxDepth}) through SQS`);
    let status = "constructing";
    while (Date.now() - started < TIMEOUT_MS) {
      const tree = await api.getTree.execute(runId);
      status = tree.run.status;
      if (status === "done" || status === "failed" || status === "halted") {
        console.log(`run -> ${status} in ${Math.round((Date.now() - started) / 1000)} s`, JSON.stringify(tree.stats));
        if (tree.run.haltReason !== undefined) console.log("haltReason:", redact(tree.run.haltReason));
        const live = await container.infra.runState.get(runId);
        console.log("DynamoDB run item:", JSON.stringify(live));
        break;
      }
      await sleep(2_000);
    }
    console.log("llm calls", JSON.stringify(container.core.llmCalls()));

    // 2. A forced failure: an article message for a node that has state (claimable) but no tree row, so every
    // attempt fails the same way. Expect: 3 receives -> DLQ -> handle-dead-letter with the recorded reason.
    const nodeId = randomUuid();
    const failRun = randomUuid();
    await container.infra.nodeState.claim({ runId: failRun, nodeId, parentId: null, depth: 0 });
    await container.infra.articleQueue.send({
      pass: "article",
      runId: failRun,
      nodeId,
      parentId: null,
      topic: "Forced failure",
      depth: 0,
      maxDepth: 1,
      path: `n_${nodeId.replace(/-/g, "")}`,
      ancestors: [],
    });
    const failStarted = Date.now();
    let outcome: string | undefined;
    while (Date.now() - failStarted < 120_000) {
      const state = await container.infra.nodeState.claim({ runId: failRun, nodeId, parentId: null, depth: 0 });
      if (state.articleStatus === "failed") {
        outcome = `article failed after ${Math.round((Date.now() - failStarted) / 1000)} s; lastError: ${redact(
          (await container.infra.nodeState.lastError(nodeId)) ?? "(none)",
        )}`;
        break;
      }
      await sleep(2_000);
    }
    console.log("forced failure:", outcome ?? "NOT dead-lettered within 120 s");
    if (status !== "done" || outcome === undefined) process.exitCode = 1;
  } finally {
    await poller.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

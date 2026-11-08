// Creates the DynamoDB table and the SQS queues (with redrive) on the local emulators. Idempotent.
// Run: docker compose -f ../infra/local/compose.yaml up -d && npm run aws:local
import { ensureLocalAws, localSqsEnv, useLocalAws } from "./local-aws";

useLocalAws();

ensureLocalAws()
  .then(() => {
    console.log("local AWS ready. For a QUEUE_MODE=sqs process against the emulators, set:");
    for (const [name, value] of Object.entries(localSqsEnv())) console.log(`${name}=${value}`);
    console.log("AWS_ENDPOINT_URL_SQS=http://localhost:9324\nAWS_ENDPOINT_URL_DYNAMODB=http://localhost:8000");
  })
  .catch((error: unknown) => {
    console.error("could not set up local AWS - are the emulators running?", error);
    process.exit(1);
  });

# aws/

**Purpose:** AWS SDK v3 adapters for the build path.

**May depend on:** application/ports, domain, `@aws-sdk/client-sqs`.

**Must not depend on:** Other adapters, use-cases.

**Planned contents:**
- `sqs-node-queue.adapter.ts` — implements `node-queue.port.ts` with `SendMessage` / `SendMessageBatch` (≤ 10 per call; retries failed batch entries) (Phase 13)

**Design notes:**
- Queue URLs and region come in as constructor arguments. Credentials: the Lambda role inside AWS, the IAM user `polaris-kickoff` in Express.
- No Secrets Manager, no SSM: secrets are plain env vars (`docs/aws-retrofit.md`).
- CloudWatch alarms and SNS are configured by the user in the console; no code here.

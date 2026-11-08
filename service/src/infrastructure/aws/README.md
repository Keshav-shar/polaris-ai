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

**Built (Phase 13, 2026-11-07):** `sqs-node-queue.adapter.ts` (NodeQueuePort + StallRequeuePort: batch sends in
chunks of `QUEUE.SEND_BATCH_MAX` that throw on any failed entry; `promote` copies to the priority queue when one is
configured, else `not-queued` (A24); `sendDelayed` with `DelaySeconds <= 900` and the `stallCount` / `claimant`
attributes (A15, A18)), `sqs-insight-queue.adapter.ts` (A21), `ssm-secrets.ts` (`loadSsmParameters`: SecureStrings
under one path, env-shaped names only, C108). Endpoints for the emulators come from the SDK's own
`AWS_ENDPOINT_URL_SQS` (C145).

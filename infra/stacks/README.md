# stacks/

**Purpose:** One CDK stack per concern.

**May depend on:** infra/constructs.

**Must not depend on:** Application code.

**Planned contents:**
- `dynamodb-stack.ts` — `ephemeral_tree_nodes` (TTL attribute `ttl`) and `user_topic_progress` (no TTL)
- `sqs-stack.ts` — fan-out queue plus dead-letter queue
- `step-functions-stack.ts` — Parser, then loop of Expand/Retrieve/Guardrail/Commit, then Writer
- `api-stack.ts` — API Lambda + Function URL (plan omitted this)

**Design notes:**
- Issue 7: use zip/esbuild Lambda bundles, not container images (ECR is not Always Free).
- Issue 8: one Step Functions transition per node visit will consume the 4,000/month allotment quickly, and I could not confirm that allotment as Always Free. Verify on the AWS pricing page and consider an SQS-driven worker loop as the primary path.
- Prefer Lambda Function URLs over API Gateway; the API Gateway free tier is time-limited (verify).

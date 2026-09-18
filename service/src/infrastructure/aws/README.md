# aws/

**Purpose:** AWS SDK adapters for observability and secrets.

**May depend on:** application/ports, `@aws-sdk/client-cloudwatch`, `@aws-sdk/client-ssm`.

**Must not depend on:** DynamoDB/Postgres adapters.

**Planned contents:**
- `aws-clients.ts` — CloudWatch + SSM client init (moved here from the plan's `config/`, since it is I/O)
- `cloudwatch-metrics.adapter.ts` — guardrail pass/fail rate, retry counts
- `ssm-secrets.adapter.ts` — cached reads of Standard parameters

**Design notes:**
- CloudWatch always-free covers 10 custom metrics, and each distinct dimension combination counts as a separate metric. Keep dimensions minimal.

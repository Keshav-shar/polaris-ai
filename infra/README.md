# infra/

**Purpose:** Infrastructure notes. There is no IaC: (`docs/setup.md` → "AWS setup"), as the design doc intends. Local Docker parity (not hosting) lives in `local/` from Phase 13 (C109).

**May depend on:** Nothing.

**Must not depend on:** service/src imports.

**Planned contents:**
- `local/compose.yaml` + `local/README.md` (Phase 13, C109): ElasticMQ (SQS API, 2 queues + 2 DLQs, redrive = `QUEUE.MAX_RECEIVES`), DynamoDB Local + an init job creating `PolarisNodes`, and `api` + `worker` built from `service/Dockerfile`. Postgres/Auth come from `npx supabase start`, never duplicated here.
- AWS resource list and settings: `docs/aws-retrofit.md`.

**Design notes:**
- If IaC is ever added (CDK), it must reproduce exactly the manual resources, and stay free-tier.
- Accounts created after 2025-07-15 get a credit-based Free Plan. Confirm each service before deploy; set the $1 budget alarm first.

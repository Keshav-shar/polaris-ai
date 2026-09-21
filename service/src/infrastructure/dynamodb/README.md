# dynamodb/

**Purpose:** DynamoDB adapters for in-flight build state in the `PolarisNodes` table (node items, run counters, dedup keys).

**May depend on:** application/ports, domain, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`.

**Must not depend on:** Postgres adapters, use-cases.

**Planned contents:**
- `dynamo-node-state.store.ts` — implements `node-state.port.ts` with conditional `PutItem` / `UpdateItem` (claim, save result + expectedChildren, finish, `ADD completedChildIds` with `NOT contains`) (Phase 13)
- `dynamo-run-state.store.ts`, `dynamo-dedup.store.ts` (Phase 13)

**Design notes:**
- Every write is conditional; see the idempotency rules in `docs/aws-retrofit.md`. Every item gets `expiresAt` (TTL, `NODE_STATE_TTL_DAYS`).
- Table is provisioned 5 RCU / 5 WCU; the SDK retries throttling.
- Never read by the UI; Postgres is the permanent store.

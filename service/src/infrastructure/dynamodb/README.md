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

**Built (Phase 13, 2026-11-07):** one table `PolarisNodes`, PK `nodeId`, TTL `expiresAt` (`NODE_STATE_TTL_DAYS`).
`dynamo-node-state.store.ts` (rules 1-7 as conditional updates; drafts through `ArticleDraftPort` (A23); the A18
lease; `recordError`/`lastError` (A17); `claim` keeps `expanded`, C144), `dynamo-run-state.store.ts` (`run#<runId>`,
ADD counters, optimistic `reserveNodes`, `halt` first-wins, A16), `dynamo-dedup.store.ts` (`dedup#<runId>#<topic>`,
rule 7), `dynamo-rate-window.store.ts` (`rate#<model>#<minute>`, conditional ADD, A13), `dynamo-shared.ts` (document
client with `removeUndefinedValues`, `isConditionalFailure` by name, `expiresAt`). Unit-tested with a stubbed `send`
that asserts each expression; behaviour against a real engine is the `smoke:aws-local` run.

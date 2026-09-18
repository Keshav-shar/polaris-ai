# dynamodb/

**Purpose:** DynamoDB adapters for Tier A (ephemeral tree nodes, TTL) and Tier C (per-user progress, no TTL).

**May depend on:** application/ports, domain, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`.

**Must not depend on:** Postgres, use-cases.

**Planned contents:**
- `dynamo.client.ts` — client init
- `tree-node.store.ts` — Tier A; sets `ttl = now + 48h` on every write
- `in-memory-tree-node.store.ts` — same port, used in early build steps and unit tests
- `progress.repository.ts` — Tier C, PK `user_id`, SK `topic_id`

**Design notes:**
- Writes from Lambda retries/SQS redelivery are at-least-once: use conditional writes so a repeated node visit is idempotent.

# integration/

**Purpose:** Adapter tests against local Postgres and DynamoDB Local, verifying the SQL and item shapes actually work.

**May depend on:** infrastructure, fixtures.

**Must not depend on:** Hosted Supabase/AWS accounts (must run offline for free).

**Planned contents:**
- `postgres/*.test.ts`, `dynamodb/*.test.ts` — including the TTL attribute and ltree queries

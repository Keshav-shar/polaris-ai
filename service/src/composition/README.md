# composition/

**Purpose:** The composition root: the single place that constructs adapters and binds them to ports. Swapping in-memory for DynamoDB (plan step 7) is a change here only.

**May depend on:** Everything.

**Must not depend on:** Being imported by domain, application or infrastructure.

**Planned contents:**
- `container.ts` — builds and returns use-cases with their dependencies wired

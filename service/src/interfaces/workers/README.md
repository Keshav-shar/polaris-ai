# workers/

**Purpose:** AWS Lambda handlers. Each invocation does one unit of work and must be idempotent.

**May depend on:** application/use-cases, application/graph, composition, shared.

**Must not depend on:** infrastructure directly.

**Planned contents:**
- `bfs-step.lambda.ts` — one invocation = one node visit
- `writer-step.lambda.ts` — committed node to article + quiz

**Design notes:**
- Issue 7: ship as zip/esbuild bundles, not container images. Container images need ECR, which is not Always Free.

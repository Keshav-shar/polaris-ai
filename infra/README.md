# infra/

**Purpose:** AWS CDK (TypeScript) infrastructure as code. Provisions only free-tier-eligible resources.

**May depend on:** aws-cdk-lib, constructs. Built artefacts of service/.

**Must not depend on:** service/src imports (infra references bundled output, not source internals).

**Planned contents:**
See the sub-folders; this folder holds no files of its own.

**Design notes:**
- Issue 9: accounts created after 2025-07-15 get a credit-based Free Plan (about 6 months). Lambda, DynamoDB, SQS and CloudWatch limits remain Always Free, but confirm each service on the AWS Free Tier page before deploy (plan step 11).
- Set a budget alarm before the first deploy.

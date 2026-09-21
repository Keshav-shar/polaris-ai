# stacks/

**Purpose:** Reserved for CDK stacks if IaC is added later. Unused today.

**May depend on:** infra/constructs.

**Must not depend on:** Application code.

**Planned contents:**
- None. Resources are created manually per `docs/setup.md`.

**Design notes:**
- Lambda bundles are zips, never container images (ECR is not Always Free).
- Step Functions and API Gateway are not used.

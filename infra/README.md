# infra/

**Purpose:** Infrastructure notes. There is no IaC: the user creates the AWS resources by hand (`docs/setup.md` → "AWS setup"), as the design doc intends.

**May depend on:** Nothing.

**Must not depend on:** service/src imports.

**Planned contents:**
- None. Resource list and settings: `docs/aws-retrofit.md`.

**Design notes:**
- If IaC is ever added (CDK), it must reproduce exactly the manual resources, and stay free-tier.
- Accounts created after 2025-07-15 get a credit-based Free Plan. Confirm each service before deploy; set the $1 budget alarm first.

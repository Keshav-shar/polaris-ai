# interfaces/

**Purpose:** Inbound adapters: HTTP and Lambda worker entry points. Thin: parse and validate input, call one use-case, map the result or error.

**May depend on:** application/use-cases, domain/schemas, domain/errors, shared, and `composition` (entry points only).

**Must not depend on:** infrastructure directly. Business logic.

**Planned contents:**
See the sub-folders; this folder holds no files of its own.

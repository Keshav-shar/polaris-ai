# http/

**Purpose:** Express application bootstrap.

**May depend on:** interfaces/http/*, application/use-cases, composition.

**Must not depend on:** infrastructure directly.

**Planned contents:**
- `server.ts` — builds the Express app; exports the app so tests and the Lambda adapter share it

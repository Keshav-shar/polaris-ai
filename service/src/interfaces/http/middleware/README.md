# middleware/

**Purpose:** Cross-cutting HTTP concerns.

**May depend on:** domain/errors, domain/schemas, shared.

**Must not depend on:** Business logic.

**Planned contents:**
- `auth.middleware.ts` — verifies the Supabase JWT
- `require-superadmin.middleware.ts`
- `validate.middleware.ts` — Zod validation of body/params/query
- `error-handler.middleware.ts` — maps domain errors to HTTP status codes

**Design notes:**
- Issue 5: the superadmin check depends on a role claim that the plan does not yet define.

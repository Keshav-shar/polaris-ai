# auth/

**Purpose:** Adapters that turn a bearer token into a `Caller` (`AuthVerifierPort`, C105).

**May depend on:** application/ports, domain, `jose`.

**Must not depend on:** Other adapters, use-cases, interfaces.

**Contents:**
- `supabase-jwt-verifier.adapter.ts` — `createSupabaseJwtVerifier({ supabaseUrl, keys? })`: verifies a Supabase
  access token LOCALLY against `<url>/auth/v1/.well-known/jwks.json` (cached by jose, refetch cooldown 30 s):
  issuer, audience `authenticated`, expiry, signature (ES256 / RS256 / EdDSA only - never HS256), `role =
  authenticated`, `sub` a uuid. Invalid -> `undefined` (401); key set unreachable -> `DependencyUnavailableError`
  (503), because the token was never judged. Never logs the token

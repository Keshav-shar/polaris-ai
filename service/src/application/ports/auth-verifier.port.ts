import type { Caller } from "../../domain/schemas/caller.schema";

// Turns a bearer token into a Caller (C105). Supabase signs access tokens with the project's asymmetric key, so
// the adapter verifies them locally against the published JWKS - no network call per request once the key set
// is cached.
export type AuthVerifierPort = {
  // undefined = the token is not valid (bad signature, expired, wrong issuer or audience, not a user). Throws
  // only when verification could not be attempted at all (the key set is unreachable), which is a 503, not a
  // 401: the token may be perfectly good.
  verify(token: string): Promise<Caller | undefined>;
};

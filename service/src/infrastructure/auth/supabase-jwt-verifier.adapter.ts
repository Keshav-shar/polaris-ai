import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { AuthVerifierPort } from "../../application/ports/auth-verifier.port";
import { DependencyUnavailableError } from "../../domain/errors/dependency-unavailable.error";
import { Caller } from "../../domain/schemas/caller.schema";

export type SupabaseJwtVerifierConfig = {
  supabaseUrl: string;
  // Tests pass a local key set; production fetches the project's published one.
  keys?: JWTVerifyGetKey;
};

// Signing algorithms Supabase's asymmetric JWT keys use. HS256 is deliberately absent: a shared-secret token
// cannot be checked against a public key set, and accepting "none" or HS256 here is the classic key-confusion
// hole.
const ALGORITHMS = ["ES256", "RS256", "EdDSA"];

// Verifies a Supabase access token LOCALLY against the project's JWKS (C105): issuer, audience, expiry, signature,
// and that it is a signed-in user's token rather than the anon or service key. The key set is fetched once and
// cached by jose, so a request costs no network call. Never logs or echoes the token.
export function createSupabaseJwtVerifier({ supabaseUrl, keys }: SupabaseJwtVerifierConfig): AuthVerifierPort {
  const issuer = `${supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
  const keySet =
    keys ??
    createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
      timeoutDuration: 5_000,
      // A token signed with a rotated-in key triggers a refetch, but at most every 30 s.
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });

  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, keySet, { issuer, audience: "authenticated", algorithms: ALGORITHMS });
        if (payload.role !== "authenticated") return undefined;
        const caller = Caller.safeParse({ userId: payload.sub });
        return caller.success ? caller.data : undefined;
      } catch (error) {
        // The key set could not be fetched: the token was never judged, so this must not read as a bad token.
        if (error instanceof errors.JWKSTimeout || !(error instanceof errors.JOSEError)) {
          throw new DependencyUnavailableError(
            "sign-in",
            "verify access token",
            error instanceof Error ? error.message : String(error),
          );
        }
        // Expired, bad signature, wrong issuer/audience, unknown key id, malformed: simply not a valid token.
        return undefined;
      }
    },
  };
}

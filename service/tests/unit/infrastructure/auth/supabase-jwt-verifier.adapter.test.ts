import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { DependencyUnavailableError } from "../../../../src/domain/errors/dependency-unavailable.error";
import { createSupabaseJwtVerifier } from "../../../../src/infrastructure/auth/supabase-jwt-verifier.adapter";

// A local ES256 key pair stands in for the project's JWKS: no network, the same verification path.
const url = "https://demo.supabase.co";
const issuer = `${url}/auth/v1`;
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let verifier: ReturnType<typeof createSupabaseJwtVerifier>;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "ES256" };
  verifier = createSupabaseJwtVerifier({ supabaseUrl: `${url}/`, keys: createLocalJWKSet({ keys: [jwk] }) });
});

function token(
  claims: Record<string, unknown> = {},
  { exp = "1h", iss = issuer, aud = "authenticated", sub = userId } = {},
) {
  return new SignJWT({ role: "authenticated", ...claims })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setSubject(sub)
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(privateKey);
}

describe("createSupabaseJwtVerifier (C105)", () => {
  it("turns a valid user token into its caller", async () => {
    await expect(verifier.verify(await token())).resolves.toEqual({ userId });
  });

  it("rejects an expired token, a foreign issuer and a non-user audience", async () => {
    await expect(verifier.verify(await token({}, { exp: "-1m" }))).resolves.toBeUndefined();
    await expect(verifier.verify(await token({}, { iss: "https://evil.example/auth/v1" }))).resolves.toBeUndefined();
    await expect(verifier.verify(await token({}, { aud: "anon" }))).resolves.toBeUndefined();
  });

  it("rejects a token that is not a signed-in user's, even when correctly signed", async () => {
    await expect(verifier.verify(await token({ role: "service_role" }))).resolves.toBeUndefined();
    await expect(verifier.verify(await token({}, { sub: "not-a-uuid" }))).resolves.toBeUndefined();
  });

  it("refuses an HS256 token outright: no key confusion with a shared secret", async () => {
    const hs = await new SignJWT({ role: "authenticated" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuer(issuer)
      .setAudience("authenticated")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("a-shared-secret-of-at-least-32-bytes!!"));
    await expect(verifier.verify(hs)).resolves.toBeUndefined();
    await expect(verifier.verify("not.a.jwt")).resolves.toBeUndefined();
  });

  it("reports an unreachable key set as a dependency outage, not as a bad token", async () => {
    const offline = createSupabaseJwtVerifier({
      supabaseUrl: url,
      keys: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(offline.verify(await token())).rejects.toBeInstanceOf(DependencyUnavailableError);
  });
});

import type { AuthVerifierPort } from "../application/ports/auth-verifier.port";
import { type Env, supabaseEnv } from "../config/env";
import { createSupabaseJwtVerifier } from "../infrastructure/auth/supabase-jwt-verifier.adapter";

// The access-token verifier, when sign-in is on: whenever Supabase is configured (C105, C137). undefined = auth
// off, the pre-Phase-12 behaviour for a local run with no Supabase project.
export function createAuthVerifierFromEnv(env: Env): AuthVerifierPort | undefined {
  const supabase = supabaseEnv(env);
  return supabase === undefined ? undefined : createSupabaseJwtVerifier({ supabaseUrl: supabase.url });
}

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Referenced literally so Next inlines them into the browser bundle. The ANON (publishable) key only: it can
// sign a user in and nothing else, because every table is RLS deny-by-default (C107). The service-role key never
// appears in ui/.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Sign-in exists only when the project is configured; without it the UI behaves as before Phase 12.
export const authEnabled = url !== undefined && url !== "" && anonKey !== undefined && anonKey !== "";

let client: SupabaseClient | undefined;

// The browser's Supabase client, used for AUTH ONLY (C105): sign-in, sign-out and reading the session. PKCE flow;
// the session lives in cookies managed by @supabase/ssr. undefined on the server and when auth is off.
export function getSupabase(): SupabaseClient | undefined {
  if (!authEnabled || typeof window === "undefined" || url === undefined || anonKey === undefined) return undefined;
  client ??= createBrowserClient(url, anonKey);
  return client;
}

// The current access token, refreshed by the client when it is near expiry; undefined when signed out.
export async function accessToken(): Promise<string | undefined> {
  const supabase = getSupabase();
  if (supabase === undefined) return undefined;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? undefined;
}

// Where to land after signing in. Only a same-site path is accepted, so a crafted link cannot bounce a fresh
// session to another origin ("//evil.example" and "/\\evil" are both refused).
export function safeNext(value: string | null | undefined): string {
  if (value === null || value === undefined) return "/";
  return /^\/(?![\/\\])/.test(value) ? value : "/";
}

const NEXT_KEY = "polaris:after-sign-in";

// The redirect target is kept in sessionStorage rather than the callback URL: Supabase matches redirect URLs
// against an exact allow-list, which a query string would break.
export function rememberNext(path: string): void {
  try {
    sessionStorage.setItem(NEXT_KEY, safeNext(path));
  } catch {
    // Storage blocked: the callback simply lands on the home page.
  }
}

export function takeNext(): string {
  try {
    const value = sessionStorage.getItem(NEXT_KEY);
    sessionStorage.removeItem(NEXT_KEY);
    return safeNext(value);
  } catch {
    return "/";
  }
}

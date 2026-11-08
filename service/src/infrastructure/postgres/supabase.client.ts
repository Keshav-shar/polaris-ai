import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Db = SupabaseClient;

export type SupabaseServiceConfig = { url: string; serviceRoleKey: string };

// The ONE way this process talks to Postgres (C107): supabase-js over HTTPS with the service-role key, which
// bypasses RLS - so it is built only in composition/, from server env, and never reaches ui/. No session is
// kept or refreshed: this client acts as the service, never as a signed-in user.
export function createSupabaseServiceClient({ url, serviceRoleKey }: SupabaseServiceConfig): Db {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

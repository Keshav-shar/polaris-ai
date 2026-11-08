"use client";

import { useEffect, useState } from "react";
import { authEnabled, getSupabase } from "./supabase-browser";

export type SessionState =
  | { status: "disabled" }
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; userId: string; email: string | undefined };

// Who is signed in, kept current across sign-in, sign-out and token refresh (including from another tab).
// "disabled" = no Supabase configured, so nothing in the UI should mention signing in.
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>(authEnabled ? { status: "loading" } : { status: "disabled" });

  useEffect(() => {
    const supabase = getSupabase();
    if (supabase === undefined) return;
    let active = true;
    const apply = (user: { id: string; email?: string | undefined } | null | undefined): void => {
      if (!active) return;
      setState(user ? { status: "signed-in", userId: user.id, email: user.email } : { status: "signed-out" });
    };
    void supabase.auth.getSession().then(({ data }) => apply(data.session?.user));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => apply(session?.user));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return state;
}

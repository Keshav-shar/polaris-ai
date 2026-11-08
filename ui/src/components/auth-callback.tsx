"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getSupabase, takeNext } from "../lib/supabase-browser";

// Where the magic link and GitHub return. The browser client exchanges the PKCE `code` in the URL for a session
// as it initialises; this page waits for that, then continues to wherever sign-in started.
export function AuthCallback() {
  const params = useSearchParams();
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    // The provider reported an error (link expired, access denied): its text is not shown.
    if (supabase === undefined || params.get("error") !== null) {
      setFailed(true);
      return;
    }
    let active = true;
    void (async () => {
      let { data } = await supabase.auth.getSession();
      const code = params.get("code");
      if (data.session === null && code !== null) {
        await supabase.auth.exchangeCodeForSession(code);
        ({ data } = await supabase.auth.getSession());
      }
      if (!active) return;
      if (data.session === null) setFailed(true);
      else router.replace(takeNext());
    })();
    return () => {
      active = false;
    };
  }, [params, router]);

  if (failed) {
    return (
      <div className="space-y-3">
        <p className="font-serif text-xl font-bold text-ink">That sign-in link didn&apos;t work</p>
        <p className="text-sm text-muted">It may have expired or already been used. Ask for a new one.</p>
        <Link href="/sign-in" className="text-sm font-medium text-gold-ink hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <p role="status" className="font-serif text-lg text-gold-ink">
      Signing you in…
    </p>
  );
}

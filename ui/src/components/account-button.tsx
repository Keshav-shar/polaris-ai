"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { getSupabase } from "../lib/supabase-browser";
import { useSession } from "../lib/use-session";

// The header's sign-in / sign-out control. Renders nothing when sign-in is not configured.
export function AccountButton() {
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  if (session.status === "disabled" || session.status === "loading") return null;

  if (session.status === "signed-out") {
    const next = pathname === "/sign-in" ? "/" : pathname;
    return (
      <Link
        href={`/sign-in?next=${encodeURIComponent(next)}`}
        className="rounded-full border border-ink px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-ink transition-colors hover:border-gold hover:text-gold-ink"
      >
        Sign in
      </Link>
    );
  }

  const signOut = async (): Promise<void> => {
    setLeaving(true);
    await getSupabase()?.auth.signOut();
    setLeaving(false);
    router.push("/");
  };

  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="max-w-40 truncate text-subtle" title={session.email}>
        {session.email ?? "Signed in"}
      </span>
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={leaving}
        className="font-semibold uppercase tracking-widest text-ink hover:text-gold-ink disabled:opacity-50"
      >
        Sign out
      </button>
    </div>
  );
}

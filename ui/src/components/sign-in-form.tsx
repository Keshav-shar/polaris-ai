"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { authEnabled, getSupabase, rememberNext, safeNext } from "../lib/supabase-browser";
import { useSession } from "../lib/use-session";

type Sent = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; email: string } | { kind: "error"; message: string };

// Email magic link + GitHub (C105). No passwords: Supabase emails a one-time link, or GitHub vouches for the
// learner. Provider error text is never shown raw.
export function SignInForm() {
  const params = useSearchParams();
  const router = useRouter();
  const session = useSession();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<Sent>({ kind: "idle" });

  // Already signed in (or just finished in another tab): go where they were heading.
  useEffect(() => {
    if (session.status === "signed-in") router.replace(next);
  }, [session.status, next, router]);

  // Branches on the build-time constant only: it is identical on the server and in the browser, so the first
  // client render matches the HTML. The client itself and `window` exist in the browser alone, so both are
  // touched inside the handlers, never while rendering (that mismatch was a hydration failure).
  if (!authEnabled) {
    return <p className="text-sm text-muted">Sign-in isn&apos;t set up on this copy of Polaris, so you don&apos;t need it.</p>;
  }

  const callbackUrl = (): string => `${window.location.origin}/auth/callback`;
  const unavailable: Sent = { kind: "error", message: "Sign-in isn't available right now. Please reload the page." };

  const sendLink = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const address = email.trim();
    const supabase = getSupabase();
    if (address === "") return;
    if (supabase === undefined) {
      setSent(unavailable);
      return;
    }
    setSent({ kind: "sending" });
    rememberNext(next);
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: callbackUrl() },
    });
    setSent(
      error === null
        ? { kind: "sent", email: address }
        : { kind: "error", message: "We couldn't send the link. Check the address and try again in a minute." },
    );
  };

  const withGitHub = async (): Promise<void> => {
    const supabase = getSupabase();
    if (supabase === undefined) {
      setSent(unavailable);
      return;
    }
    rememberNext(next);
    const { error } = await supabase.auth.signInWithOAuth({ provider: "github", options: { redirectTo: callbackUrl() } });
    if (error !== null) setSent({ kind: "error", message: "GitHub sign-in isn't available right now. Try the email link." });
  };

  if (sent.kind === "sent") {
    return (
      <div role="status" className="space-y-2">
        <p className="font-serif text-xl font-bold text-ink">Check your inbox</p>
        <p className="text-sm text-muted">
          We sent a sign-in link to <span className="font-semibold text-ink">{sent.email}</span>. Open it on this
          device to continue.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <form onSubmit={(e) => void sendLink(e)} className="space-y-3">
        <label htmlFor="email" className="block text-xs font-bold uppercase tracking-widest text-muted">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink-soft placeholder-faint shadow-inner focus:outline-none focus:ring-1 focus:ring-gold"
        />
        <button
          type="submit"
          disabled={sent.kind === "sending"}
          className="w-full rounded-xl bg-ink px-6 py-3 text-xs font-semibold uppercase tracking-widest text-parchment transition-colors hover:bg-gold-ink disabled:opacity-50"
        >
          {sent.kind === "sending" ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>

      <div className="flex items-center gap-3 text-[11px] uppercase tracking-widest text-faint">
        <span className="h-px flex-1 bg-rule" aria-hidden="true" />
        or
        <span className="h-px flex-1 bg-rule" aria-hidden="true" />
      </div>

      <button
        type="button"
        onClick={() => void withGitHub()}
        className="w-full rounded-xl border border-line bg-white px-6 py-3 text-xs font-semibold uppercase tracking-widest text-ink transition-colors hover:border-gold"
      >
        Continue with GitHub
      </button>

      {sent.kind === "error" ? (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          {sent.message}
        </p>
      ) : null}
    </div>
  );
}

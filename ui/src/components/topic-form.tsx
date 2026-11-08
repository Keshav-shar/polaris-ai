"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { startTree } from "../lib/api-client";
import { friendlyError, needsSignIn } from "../lib/friendly-error";

const PROMPT_MAX_LENGTH = 500; // TreeRequestBody: z.string().trim().min(1).max(500)
const MAX_DEPTH_CEILING = 6; // service/src/config/constants.ts
const TOAST_MS = 3_500;

// "auto" means send no maxDepth at all: the service takes a depth stated in the prompt ("3 levels deep"),
// else its default (C100). Nothing here can raise a run past MAX_DEPTH_CEILING or MAX_NODES_PER_RUN.
const DEPTH_HINT: Record<number, string> = {
  1: "quick overview",
  2: "the main ideas",
  3: "a solid course",
  4: "detailed study",
  5: "in-depth",
  6: "deep dive",
};
const DEPTH_OPTIONS = Array.from({ length: MAX_DEPTH_CEILING }, (_, i) => i + 1);

const FIELD =
  "w-full rounded-xl border border-line bg-white text-sm text-ink-soft placeholder-faint shadow-inner focus:outline-none focus:ring-1 focus:ring-gold disabled:opacity-60";

export function TopicForm({
  onStarted,
  disabled = false,
}: {
  onStarted: (runId: string) => void;
  disabled?: boolean;
}) {
  const [prompt, setPrompt] = useState("");
  const [depth, setDepth] = useState("auto");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [signInFirst, setSignInFirst] = useState(false);
  // The toast's text: a started map, plus how many old maps the stored-map cap removed to make room.
  const [toast, setToast] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (toast === undefined) return;
    const timer = setTimeout(() => setToast(undefined), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const busy = submitting || disabled;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || prompt.trim() === "") return;
    setSubmitting(true);
    setError(undefined);
    setSignInFirst(false);
    try {
      const { runId, prunedRuns } = await startTree(prompt.trim(), depth === "auto" ? undefined : Number(depth));
      setPrompt("");
      setToast(
        prunedRuns === undefined
          ? "Your map is on its way…"
          : `Your map is on its way. We removed your ${prunedRuns} oldest map${prunedRuns === 1 ? "" : "s"} to make room.`,
      );
      onStarted(runId);
    } catch (err) {
      // A 429 is a "not right now", not a failure: friendlyError says when to try again.
      if (needsSignIn(err)) setSignInFirst(true);
      else setError(friendlyError(err, "We couldn't start your map. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="parchment-card space-y-5 rounded-2xl p-6 shadow-sm md:p-8">
        <div>
          <label htmlFor="prompt" className="mb-2 block text-xs font-bold uppercase tracking-widest text-muted">
            What would you like to learn?
          </label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={PROMPT_MAX_LENGTH}
            rows={2}
            required
            disabled={busy}
            placeholder="e.g. teach me photosynthesis, 2 levels deep"
            className={`${FIELD} resize-none p-4`}
          />
          <p className="mt-1 text-right text-[11px] text-faint">
            {prompt.length}/{PROMPT_MAX_LENGTH}
          </p>
        </div>

        <div>
          <label htmlFor="depth" className="mb-2 block text-xs font-bold uppercase tracking-widest text-muted">
            How deep should it go?
          </label>
          <div className="relative">
            <select
              id="depth"
              value={depth}
              onChange={(e) => setDepth(e.target.value)}
              disabled={busy}
              className={`${FIELD} cursor-pointer appearance-none px-4 py-3 pr-10`}
            >
              <option value="auto">Auto (from what you typed)</option>
              {DEPTH_OPTIONS.map((d) => (
                <option key={d} value={String(d)}>
                  {d} level{d === 1 ? "" : "s"}: {DEPTH_HINT[d] ?? ""}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-muted">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </span>
          </div>
          <p className="mt-2 text-[11px] text-faint">
            Deeper maps have more lessons and take longer to build. Start small if you just want the basics.
          </p>
        </div>

        <button
          type="submit"
          disabled={busy || prompt.trim() === ""}
          className="group inline-flex w-full cursor-pointer items-center justify-center gap-3 rounded-xl bg-ink px-8 py-4 text-xs font-semibold uppercase tracking-widest text-parchment shadow-md transition-all duration-300 hover:bg-gold-ink disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          <span>{submitting ? "Building your map…" : "Build my learning map"}</span>
          <svg
            className="h-4 w-4 transition-transform group-hover:translate-x-1"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </button>

        {error === undefined ? null : (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            {error}
          </p>
        )}
        {signInFirst ? (
          <p role="alert" className="rounded-xl border border-line bg-gold-soft p-3 text-sm text-ink">
            Sign in first, so your map is saved to your library.{" "}
            <Link href="/sign-in?next=/" className="font-semibold text-gold-ink hover:underline">
              Sign in
            </Link>
          </p>
        ) : null}
      </form>

      {toast !== undefined ? (
        <div
          role="status"
          className="fixed right-6 bottom-6 z-50 animate-toast-in rounded-xl bg-ink px-6 py-3 text-xs font-semibold uppercase tracking-wider text-parchment shadow-lg"
        >
          {toast}
        </div>
      ) : null}
    </>
  );
}

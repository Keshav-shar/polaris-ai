"use client";

import { useState } from "react";
import { ApiClientError, startTree } from "../lib/api-client";

const PROMPT_MAX_LENGTH = 500; // TreeRequestBody: z.string().trim().min(1).max(500)
const MAX_DEPTH_CEILING = 6; // service/src/config/constants.ts

// "auto" means send no maxDepth at all: the service takes a depth stated in the prompt ("3 levels deep"),
// else its default (C100). Nothing here can raise a run past MAX_DEPTH_CEILING or MAX_NODES_PER_RUN.
const DEPTH_OPTIONS = Array.from({ length: MAX_DEPTH_CEILING }, (_, i) => i + 1);

const FIELD =
  "w-full rounded-xl border border-astral-gold/30 bg-astral-900 px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 transition-colors focus:border-astral-gold focus:outline-none disabled:opacity-55";

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

  const busy = submitting || disabled;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || prompt.trim() === "") return;
    setSubmitting(true);
    setError(undefined);
    try {
      const { runId } = await startTree(prompt.trim(), depth === "auto" ? undefined : Number(depth));
      setPrompt("");
      onStarted(runId);
    } catch (err) {
      // 429 carries the API's own Retry-After: a refusal to spend LLM quota, not a failure, so the
      // message says when to try again rather than reading as an error.
      if (err instanceof ApiClientError && err.status === 429) {
        const wait = err.retryAfterSeconds;
        setError(`${err.message}${wait === undefined ? "" : ` Try again in ${Math.ceil(wait)}s.`}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Could not start the build.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mystic-panel arch-border space-y-4 rounded-2xl p-6">
      <div className="space-y-1.5">
        <label htmlFor="prompt" className="block font-serif text-sm font-bold text-astral-gold">
          What should Polaris teach you?
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={PROMPT_MAX_LENGTH}
          rows={3}
          required
          disabled={busy}
          placeholder="teach me photosynthesis, 2 levels deep"
          className={`${FIELD} resize-y`}
        />
        <p className="text-right font-mono text-[11px] text-slate-500">
          {prompt.length}/{PROMPT_MAX_LENGTH}
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="depth" className="block font-serif text-sm font-bold text-astral-gold">
          Depth cap
        </label>
        <select
          id="depth"
          value={depth}
          onChange={(e) => setDepth(e.target.value)}
          disabled={busy}
          className={`${FIELD} max-w-xs`}
        >
          <option value="auto">auto (from the prompt)</option>
          {DEPTH_OPTIONS.map((d) => (
            <option key={d} value={String(d)}>
              {d}
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-500">
          Star count grows with depth and every star costs an LLM call. A cap only lowers what the prompt
          asks for.
        </p>
      </div>

      <button
        type="submit"
        disabled={busy || prompt.trim() === ""}
        className="rounded-xl border border-astral-gold/40 bg-gradient-to-r from-astral-gold/20 to-astral-amber/20 px-6 py-2.5 font-serif text-sm text-astral-gold shadow-gold-glow transition-all hover:from-astral-gold/30 hover:to-astral-amber/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
      >
        {submitting ? "Consulting the stars…" : "Chart the constellation"}
      </button>

      {error === undefined ? null : (
        <p role="alert" className="rounded-xl border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}

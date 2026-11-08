"use client";

import { useState } from "react";
import { setRunVisibility } from "../lib/api-client";
import type { RunVisibility } from "../lib/contract";
import { friendlyError } from "../lib/friendly-error";

const LABEL: Record<RunVisibility, string> = {
  private: "Only me",
  unlisted: "Anyone with the link",
  public: "Everyone (listed in Explore)",
};

// The owner decides who may open this map (C105). Shown only to the owner; the API refuses anyone else anyway.
export function ShareControl({ runId, visibility }: { runId: string; visibility: RunVisibility }) {
  const [current, setCurrent] = useState<RunVisibility>(visibility);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const change = async (next: RunVisibility): Promise<void> => {
    setSaving(true);
    setError(undefined);
    try {
      setCurrent((await setRunVisibility(runId, next)).visibility);
    } catch (err) {
      setError(friendlyError(err, "We couldn't change who can see this map."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label htmlFor="share" className="font-semibold uppercase tracking-widest text-muted">
        Who can see this
      </label>
      <select
        id="share"
        value={current}
        disabled={saving}
        onChange={(e) => void change(e.target.value as RunVisibility)}
        className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs text-ink-soft focus:outline-none focus:ring-1 focus:ring-gold disabled:opacity-60"
      >
        {(Object.keys(LABEL) as RunVisibility[]).map((v) => (
          <option key={v} value={v}>
            {LABEL[v]}
          </option>
        ))}
      </select>
      {error === undefined ? null : (
        <span role="alert" className="text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

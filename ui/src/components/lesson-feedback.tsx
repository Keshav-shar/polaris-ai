"use client";

import { useState } from "react";
import { saveLessonFeedback } from "../lib/api-client";
import type { FeedbackTag, LessonFeedback } from "../lib/contract";
import { friendlyError } from "../lib/friendly-error";

// The service's FeedbackTag enum, repeated as runtime values because only TYPES may cross the package boundary.
// The two assertions fail `tsc` if the enum gains or loses a member, so the copy cannot drift.
const TAGS = [
  ["just-right", "Just right"],
  ["too-basic", "Too basic"],
  ["too-advanced", "Too advanced"],
  ["too-long", "Too long"],
  ["too-short", "Too short"],
  ["needs-examples", "Needs examples"],
  ["unclear", "Unclear"],
] as const satisfies readonly (readonly [FeedbackTag, string])[];
type NoMember<T extends never> = T;
type _AllTags = NoMember<Exclude<FeedbackTag, (typeof TAGS)[number][0]>>;
// Mirrors FEEDBACK.MAX_TAGS; the service refuses more with 400.
const MAX_TAGS = 4;

type Save = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

// A thumb and a few fixed tags per lesson, never free text (C138). Polaris reads them later, in bulk, to pitch this
// learner's next maps (C139); nothing is sent to a model from here.
export function LessonFeedbackPanel({ nodeId, initial }: { nodeId: string; initial: LessonFeedback | undefined }) {
  const [helpful, setHelpful] = useState<boolean | null>(initial?.helpful ?? null);
  const [tags, setTags] = useState<readonly FeedbackTag[]>(initial?.tags ?? []);
  const [save, setSave] = useState<Save>({ kind: "idle" });

  const persist = async (nextHelpful: boolean | null, nextTags: readonly FeedbackTag[]): Promise<void> => {
    setSave({ kind: "saving" });
    try {
      await saveLessonFeedback(nodeId, { helpful: nextHelpful, tags: [...nextTags] });
      setSave({ kind: "saved" });
    } catch (error) {
      setSave({ kind: "error", message: friendlyError(error, "We couldn't save that. Please try again.") });
    }
  };

  const thumb = (value: boolean): void => {
    const next = helpful === value ? null : value;
    setHelpful(next);
    void persist(next, tags);
  };

  const toggle = (tag: FeedbackTag): void => {
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    if (next.length > MAX_TAGS) return;
    setTags(next);
    void persist(helpful, next);
  };

  const chip = (active: boolean): string =>
    `rounded-full border px-3 py-1 text-xs transition-colors ${
      active ? "border-gold bg-gold-soft font-semibold text-ink" : "border-line bg-white text-ink-soft hover:border-gold"
    }`;

  return (
    <section aria-label="How was this lesson?" className="parchment-card space-y-3 rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-lg font-bold text-ink">How was this lesson?</h2>
        <p role="status" className="text-[11px] text-faint">
          {save.kind === "saving" ? "Saving…" : save.kind === "saved" ? "Thanks, saved." : ""}
        </p>
      </div>
      <div className="flex gap-2">
        <button type="button" aria-pressed={helpful === true} onClick={() => thumb(true)} className={chip(helpful === true)}>
          Helpful
        </button>
        <button
          type="button"
          aria-pressed={helpful === false}
          onClick={() => thumb(false)}
          className={chip(helpful === false)}
        >
          Not helpful
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {TAGS.map(([tag, label]) => (
          <button
            key={tag}
            type="button"
            aria-pressed={tags.includes(tag)}
            disabled={!tags.includes(tag) && tags.length >= MAX_TAGS}
            onClick={() => toggle(tag)}
            className={`${chip(tags.includes(tag))} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-faint">Your answers help Polaris pitch your next learning maps.</p>
      {save.kind === "error" ? (
        <p role="alert" className="text-xs text-danger">
          {save.message}
        </p>
      ) : null}
    </section>
  );
}

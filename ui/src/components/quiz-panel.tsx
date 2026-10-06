"use client";

import { useState } from "react";
import type { QuizQuestion } from "../lib/contract";

// Client-side scoring only: nothing about an attempt is sent anywhere or stored (docs/conflicts.md C29,
// and CLAUDE.md's "Quiz scores are never stored"). Reloading the page is a fresh attempt.
export function QuizPanel({ questions, passMark }: { questions: readonly QuizQuestion[]; passMark: number }) {
  const [chosen, setChosen] = useState<ReadonlyMap<number, number>>(new Map());
  const [submitted, setSubmitted] = useState(false);

  const correct = questions.filter((q, i) => chosen.get(i) === q.answerIndex).length;
  const percent = questions.length === 0 ? 0 : Math.round((correct / questions.length) * 100);
  const answeredAll = chosen.size === questions.length;

  const pick = (questionIndex: number, optionIndex: number): void => {
    if (submitted) return;
    setChosen((prev) => new Map(prev).set(questionIndex, optionIndex));
  };

  return (
    <section aria-label="Trial of knowledge" className="mystic-panel arch-border space-y-5 rounded-2xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-astral-gold/20 pb-3">
        <h2 className="font-serif text-sm font-bold text-astral-gold">Trial of Knowledge</h2>
        {submitted ? (
          <p
            role="status"
            className={`font-mono text-xs ${percent >= passMark ? "text-astral-gold" : "text-amber-400"}`}
          >
            {correct}/{questions.length} · {percent}% · {percent >= passMark ? "passed" : `needs ${passMark}%`}
          </p>
        ) : (
          <p className="font-mono text-[11px] text-slate-500">
            {chosen.size}/{questions.length} answered
          </p>
        )}
      </div>

      <ol className="space-y-5">
        {questions.map((question, qi) => {
          const picked = chosen.get(qi);
          return (
            <li key={`${qi}-${question.question}`} className="space-y-2">
              <p className="font-serif text-sm text-astral-starlight">
                {qi + 1}. {question.question}
              </p>
              <ul className="space-y-1.5">
                {question.options.map((option, oi) => {
                  const isPicked = picked === oi;
                  const isAnswer = question.answerIndex === oi;
                  // After submitting, the right answer is always marked - including when it was missed,
                  // because the point is to learn it, not just to be scored.
                  const tone = !submitted
                    ? isPicked
                      ? "border-astral-gold/60 bg-astral-gold/15 text-astral-starlight"
                      : "border-astral-600 text-slate-300 hover:border-astral-gold/40"
                    : isAnswer
                      ? "border-astral-gold bg-astral-gold/20 text-astral-starlight"
                      : isPicked
                        ? "border-red-700 bg-red-950/40 text-red-300"
                        : "border-astral-700 text-slate-500";
                  return (
                    <li key={`${oi}-${option}`}>
                      <button
                        type="button"
                        onClick={() => pick(qi, oi)}
                        disabled={submitted}
                        aria-pressed={isPicked}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${tone}`}
                      >
                        {option}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {submitted ? (
                <p className="text-[11px] leading-relaxed text-slate-400">
                  {question.explanation}{" "}
                  <a
                    href={question.evidenceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-astral-gold hover:underline"
                  >
                    source
                  </a>
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="flex items-center gap-3 border-t border-astral-gold/20 pt-4">
        {submitted ? (
          <button
            type="button"
            onClick={() => {
              setChosen(new Map());
              setSubmitted(false);
            }}
            className="rounded-xl border border-astral-gold/40 bg-astral-gold/10 px-4 py-2 font-serif text-xs text-astral-gold transition-colors hover:bg-astral-gold/20"
          >
            Try again
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setSubmitted(true)}
            disabled={!answeredAll}
            className="rounded-xl border border-astral-gold/40 bg-gradient-to-r from-astral-gold/20 to-astral-amber/20 px-4 py-2 font-serif text-xs text-astral-gold transition-all hover:from-astral-gold/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Submit the trial
          </button>
        )}
        <span className="font-mono text-[10px] text-slate-600">Nothing is recorded.</span>
      </div>
    </section>
  );
}

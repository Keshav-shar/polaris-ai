"use client";

import { useState } from "react";
import type { QuizQuestion } from "../lib/contract";

// Scored in the browser. Reloading the page is a fresh attempt.
export function QuizPanel({ questions, passMark }: { questions: readonly QuizQuestion[]; passMark: number }) {
  const [chosen, setChosen] = useState<ReadonlyMap<number, number>>(new Map());
  const [submitted, setSubmitted] = useState(false);

  const correct = questions.filter((q, i) => chosen.get(i) === q.answerIndex).length;
  const percent = questions.length === 0 ? 0 : Math.round((correct / questions.length) * 100);
  const answeredAll = chosen.size === questions.length;
  const passed = percent >= passMark;

  const pick = (questionIndex: number, optionIndex: number): void => {
    if (submitted) return;
    setChosen((prev) => new Map(prev).set(questionIndex, optionIndex));
  };

  return (
    <section aria-label="Check your understanding" className="parchment-card space-y-5 rounded-2xl p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule pb-3">
        <h2 className="font-serif text-xl font-bold text-ink">Check your understanding</h2>
        {submitted ? (
          <p role="status" className={`text-xs font-semibold ${passed ? "text-gold-ink" : "text-warn"}`}>
            {correct} of {questions.length} right ({percent}%) ·{" "}
            {passed ? "Nicely done!" : `Aim for ${passMark}%. Have another go.`}
          </p>
        ) : (
          <p className="text-[11px] text-faint">
            {chosen.size} of {questions.length} answered
          </p>
        )}
      </div>

      <ol className="space-y-5">
        {questions.map((question, qi) => {
          const picked = chosen.get(qi);
          return (
            <li key={`${qi}-${question.question}`} className="space-y-2">
              <p className="font-serif text-lg font-semibold text-ink">
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
                      ? "border-gold bg-gold-soft text-ink"
                      : "border-line bg-white text-ink-soft hover:border-gold"
                    : isAnswer
                      ? "border-gold bg-gold-soft font-semibold text-ink"
                      : isPicked
                        ? "border-danger/50 bg-danger-soft text-danger"
                        : "border-rule bg-white text-faint";
                  return (
                    <li key={`${oi}-${option}`}>
                      <button
                        type="button"
                        onClick={() => pick(qi, oi)}
                        disabled={submitted}
                        aria-pressed={isPicked}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${tone}`}
                      >
                        {option}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {submitted ? (
                <p className="text-xs leading-relaxed text-subtle">
                  {question.explanation}{" "}
                  <a
                    href={question.evidenceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-medium text-gold-ink hover:underline"
                  >
                    Read the source
                  </a>
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="flex items-center gap-3 border-t border-rule pt-4">
        {submitted ? (
          <button
            type="button"
            onClick={() => {
              setChosen(new Map());
              setSubmitted(false);
            }}
            className="rounded-xl border border-line bg-white px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-ink transition-colors hover:border-gold"
          >
            Try again
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setSubmitted(true)}
            disabled={!answeredAll}
            className="rounded-xl bg-ink px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-parchment transition-colors hover:bg-gold-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            Check my answers
          </button>
        )}
      </div>
    </section>
  );
}

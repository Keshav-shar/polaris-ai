"use client";

import { useState } from "react";
import { submitQuizAttempt } from "../lib/api-client";
import type { PublicQuizQuestion, QuizAttemptResponse } from "../lib/contract";
import { friendlyError } from "../lib/friendly-error";

type Phase =
  | { kind: "answering" }
  | { kind: "checking" }
  | { kind: "checked"; result: QuizAttemptResponse }
  | { kind: "error"; message: string };

// Scored by the service (C106): the questions arrive without their answers, and the key, the explanations and
// the sources come back only once the learner has answered. Signed in, the attempt is saved; signed out, it is
// scored and nothing is kept.
export function QuizPanel({ nodeId, questions }: { nodeId: string; questions: readonly PublicQuizQuestion[] }) {
  const [chosen, setChosen] = useState<ReadonlyMap<number, number>>(new Map());
  const [phase, setPhase] = useState<Phase>({ kind: "answering" });

  const result = phase.kind === "checked" ? phase.result : undefined;
  const answeredAll = chosen.size === questions.length;
  const locked = phase.kind === "checking" || phase.kind === "checked";

  const pick = (questionIndex: number, optionIndex: number): void => {
    if (locked) return;
    setChosen((prev) => new Map(prev).set(questionIndex, optionIndex));
  };

  const check = async (): Promise<void> => {
    setPhase({ kind: "checking" });
    try {
      const answers = questions.map((_, i) => chosen.get(i) ?? 0);
      setPhase({ kind: "checked", result: await submitQuizAttempt(nodeId, answers) });
    } catch (error) {
      setPhase({ kind: "error", message: friendlyError(error, "We couldn't check your answers. Please try again.") });
    }
  };

  return (
    <section aria-label="Check your understanding" className="parchment-card space-y-5 rounded-2xl p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule pb-3">
        <h2 className="font-serif text-xl font-bold text-ink">Check your understanding</h2>
        {result !== undefined ? (
          <p role="status" className={`text-xs font-semibold ${result.passed ? "text-gold-ink" : "text-warn"}`}>
            {result.correct} of {result.total} right ({result.percent}%) ·{" "}
            {result.passed ? "Nicely done!" : "Have another go."}
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
          const outcome = result?.results[qi];
          return (
            <li key={`${qi}-${question.question}`} className="space-y-2">
              <p className="font-serif text-lg font-semibold text-ink">
                {qi + 1}. {question.question}
              </p>
              <ul className="space-y-1.5">
                {question.options.map((option, oi) => {
                  const isPicked = picked === oi;
                  // After checking, the right answer is always marked - including when it was missed, because
                  // the point is to learn it, not just to be scored.
                  const tone =
                    outcome === undefined
                      ? isPicked
                        ? "border-gold bg-gold-soft text-ink"
                        : "border-line bg-white text-ink-soft hover:border-gold"
                      : outcome.answerIndex === oi
                        ? "border-gold bg-gold-soft font-semibold text-ink"
                        : isPicked
                          ? "border-danger/50 bg-danger-soft text-danger"
                          : "border-rule bg-white text-faint";
                  return (
                    <li key={`${oi}-${option}`}>
                      <button
                        type="button"
                        onClick={() => pick(qi, oi)}
                        disabled={locked}
                        aria-pressed={isPicked}
                        className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${tone}`}
                      >
                        {option}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {outcome === undefined ? null : (
                <p className="text-xs leading-relaxed text-subtle">
                  {outcome.explanation}{" "}
                  {/^https?:\/\//.test(outcome.evidenceUrl) ? (
                    <a
                      href={outcome.evidenceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-medium text-gold-ink hover:underline"
                    >
                      Read the source
                    </a>
                  ) : null}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      {phase.kind === "error" ? (
        <p role="alert" className="text-xs text-danger">
          {phase.message}
        </p>
      ) : null}
      {result !== undefined && !result.recorded ? (
        <p className="text-[11px] text-faint">Sign in to keep track of your results.</p>
      ) : null}

      <div className="flex items-center gap-3 border-t border-rule pt-4">
        {result !== undefined ? (
          <button
            type="button"
            onClick={() => {
              setChosen(new Map());
              setPhase({ kind: "answering" });
            }}
            className="rounded-xl border border-line bg-white px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-ink transition-colors hover:border-gold"
          >
            Try again
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void check()}
            disabled={!answeredAll || phase.kind === "checking"}
            className="rounded-xl bg-ink px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-parchment transition-colors hover:bg-gold-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase.kind === "checking" ? "Checking…" : "Check my answers"}
          </button>
        )}
      </div>
    </section>
  );
}

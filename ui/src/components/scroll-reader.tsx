"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiClientError, getNode } from "../lib/api-client";
import type { NodeResponse } from "../lib/contract";
import { friendlyError } from "../lib/friendly-error";
import { ArticleBody, readingMinutes } from "./article-body";
import { EmptyState } from "./empty-state";
import { QuizPanel } from "./quiz-panel";

// Mirrors QUIZ_CONFIG.PASSING_SCORE_PERCENT. Scoring is client-side today, so the UI owns the threshold it
// displays.
const PASS_MARK_PERCENT = 70;

type State =
  | { kind: "loading" }
  | { kind: "found"; data: NodeResponse }
  | { kind: "missing" }
  | { kind: "error"; message: string };

const LINK = "font-medium text-gold-ink hover:underline";

// One lesson: the article, its sources, its quick check, and where it sits in the map.
export function ScrollReader({ nodeId }: { nodeId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });

    getNode(nodeId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ kind: "found", data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiClientError && error.status === 404) {
          setState({ kind: "missing" });
          return;
        }
        setState({ kind: "error", message: friendlyError(error, "We couldn't load this lesson. Please try again.") });
      });

    return () => controller.abort();
  }, [nodeId]);

  if (state.kind === "loading") {
    return (
      <p role="status" className="py-16 text-center font-serif text-lg text-gold-ink">
        Loading your lesson…
      </p>
    );
  }

  if (state.kind === "error") {
    return (
      <EmptyState title="This lesson didn't load">
        <p>{state.message}</p>
      </EmptyState>
    );
  }

  if (state.kind === "missing") {
    return (
      <EmptyState
        title="We couldn't find this lesson"
        action={
          <Link href="/codex" className={LINK}>
            Back to my library
          </Link>
        }
      >
        <p>It may have been removed, or the link may be incomplete.</p>
      </EmptyState>
    );
  }

  const { node, article, quiz, articleFailureReason } = state.data;

  return (
    <article className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
      <div className="space-y-6 lg:col-span-8">
        <header className="parchment-card space-y-3 rounded-2xl p-6 md:p-8">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-faint">
            <span>Level {node.depth + 1}</span>
            {article === null ? null : (
              <>
                <span aria-hidden="true">·</span>
                <span>{readingMinutes(article.contentMd)} min read</span>
              </>
            )}
            {article === null ? null : article.credibilityVerified ? (
              <span className="rounded-full border border-line bg-gold-soft px-2.5 py-0.5 normal-case tracking-normal text-gold-ink">
                Backed by sources
              </span>
            ) : (
              // Never hidden: a lesson written on thin evidence is still shown, but it says so
              // (docs/article-generation.md - it is marked unverified, not dropped).
              <span className="rounded-full border border-warn/30 bg-warn-soft px-2.5 py-0.5 normal-case tracking-normal text-warn">
                Sources not confirmed
              </span>
            )}
          </div>
          <h1 className="font-serif text-4xl font-bold text-ink">{node.topic}</h1>
          {node.brief === "" ? null : <p className="text-sm leading-relaxed text-muted">{node.brief}</p>}
        </header>

        {article === null && articleFailureReason !== undefined ? (
          // A permanent failure, not a pending one: the learner must not wait for a lesson that is never
          // coming. The diagnosis stays reachable, folded away, for whoever is debugging the run.
          <EmptyState title="This lesson couldn't be written">
            <p>
              Something went wrong while writing it, so it won&apos;t appear on its own. The other lessons in
              this map are not affected.
            </p>
            <details className="mt-3 text-left">
              <summary className="cursor-pointer text-[11px] text-faint">Technical details</summary>
              <p className="mt-1 font-code text-[11px] leading-relaxed text-subtle">{articleFailureReason}</p>
            </details>
          </EmptyState>
        ) : article === null ? (
          <EmptyState title="This lesson is still being written">
            <p>Lessons are written from the top of the map down. Check back in a moment.</p>
          </EmptyState>
        ) : (
          <section aria-label="Lesson" className="parchment-card space-y-4 rounded-2xl p-6 md:p-8">
            <ArticleBody contentMd={article.contentMd} />
            {article.citations.length === 0 ? null : (
              <div className="border-t border-rule pt-3">
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-faint">Sources</h2>
                <ol className="mt-2 space-y-1.5">
                  {article.citations.map((citation, i) => (
                    <li key={`${i}-${citation.url}`} className="text-[11px] leading-relaxed text-subtle">
                      <a href={citation.url} target="_blank" rel="noreferrer noopener" className={LINK}>
                        [{i + 1}]
                      </a>{" "}
                      {citation.claim}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>
        )}

        {quiz === null ? (
          article === null ? null : (
            // A lesson with no credible source cannot have questions, because every question must cite
            // one (docs/conflicts.md C80). Saying so beats an empty panel.
            <p className="text-xs text-subtle">
              There&apos;s no quick check for this lesson, because we couldn&apos;t find a source to base the
              questions on.
            </p>
          )
        ) : (
          <QuizPanel questions={quiz.questions} passMark={PASS_MARK_PERCENT} />
        )}
      </div>

      <aside className="space-y-4 lg:col-span-4">
        <div className="parchment-card space-y-3 rounded-2xl p-5">
          <h2 className="border-b border-rule pb-2 font-serif text-lg font-bold text-ink">Where this fits</h2>
          <dl className="space-y-3 text-xs">
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-widest text-faint">Part of</dt>
              <dd className="mt-0.5">
                {node.parent === null ? (
                  <span className="text-subtle">Nothing. This is the main topic.</span>
                ) : (
                  <Link href={`/topic/${node.parent.id}`} className={LINK}>
                    {node.parent.topic}
                  </Link>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-widest text-faint">
                Up next ({node.children.length})
              </dt>
              <dd className="mt-1 space-y-1">
                {node.children.length === 0 ? (
                  <span className="text-subtle">Nothing further. This lesson covers it all.</span>
                ) : (
                  node.children.map((child) => (
                    <Link
                      key={child.id}
                      href={`/topic/${child.id}`}
                      className="block truncate text-muted hover:text-gold-ink"
                    >
                      {child.topic}
                    </Link>
                  ))
                )}
              </dd>
            </div>
          </dl>
          <Link href={`/tree/${node.runId}`} className={`block border-t border-rule pt-3 text-xs ${LINK}`}>
            ← See the whole map
          </Link>
        </div>
      </aside>
    </article>
  );
}

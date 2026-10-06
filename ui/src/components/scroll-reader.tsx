"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiClientError, getNode } from "../lib/api-client";
import type { NodeResponse } from "../lib/contract";
import { ArticleBody, readingMinutes } from "./article-body";
import { EmptyState } from "./empty-state";
import { QuizPanel } from "./quiz-panel";

// Mirrors QUIZ_CONFIG.PASSING_SCORE_PERCENT. Scoring is client-side and nothing is stored, so the UI owns
// the threshold it displays; the service never sees an attempt.
const PASS_MARK_PERCENT = 70;

type State =
  | { kind: "loading" }
  | { kind: "found"; data: NodeResponse }
  | { kind: "missing" }
  | { kind: "error"; message: string };

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
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "Could not reach the API.",
        });
      });

    return () => controller.abort();
  }, [nodeId]);

  if (state.kind === "loading") {
    return (
      <p role="status" className="py-16 text-center font-serif text-astral-gold">
        Unrolling the scroll…
      </p>
    );
  }

  if (state.kind === "error") {
    return (
      <EmptyState title="This scroll is out of reach">
        <p>{state.message}</p>
      </EmptyState>
    );
  }

  if (state.kind === "missing") {
    return (
      <EmptyState
        title="No such star in any chart"
        action={
          <Link href="/codex" className="font-serif text-sm text-astral-gold hover:underline">
            Back to the codex
          </Link>
        }
      >
        <p>
          Runs are held in memory until Phase 12, so a scroll from before the last service restart can no
          longer be found.
        </p>
      </EmptyState>
    );
  }

  const { node, article, quiz, articleFailureReason } = state.data;

  return (
    <article className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
      <div className="space-y-6 lg:col-span-8">
        <header className="mystic-panel arch-border space-y-3 rounded-2xl p-6">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono text-[11px] text-slate-400">depth {node.depth}</span>
            {article === null ? null : (
              <span className="font-mono text-[11px] text-slate-400">
                {readingMinutes(article.contentMd)} min read
              </span>
            )}
            {article === null ? null : article.credibilityVerified ? (
              <span className="rounded-full border border-astral-gold/30 bg-astral-gold/10 px-2.5 py-0.5 font-mono text-astral-gold">
                sourced
              </span>
            ) : (
              // Never hidden: an article written on thin evidence is still shown, but it says so
              // (docs/article-generation.md - it is marked unverified, not dropped).
              <span className="rounded-full border border-amber-600/40 bg-amber-950/30 px-2.5 py-0.5 font-mono text-amber-400">
                unverified
              </span>
            )}
          </div>
          <h1 className="font-serif text-2xl font-bold text-astral-starlight">{node.topic}</h1>
          {node.brief === "" ? null : <p className="text-sm leading-relaxed text-slate-400">{node.brief}</p>}
        </header>

        {article === null && articleFailureReason !== undefined ? (
          // A permanent failure, not a pending one. Both used to render as "reload in a moment", which
          // left the reader waiting for a scroll that was never coming back.
          <EmptyState title="This scroll could not be written">
            <p>
              Polaris charted this star, but its article failed and will not arrive on its own. The rest
              of the constellation below it was written regardless.
            </p>
            <p className="mt-2 font-mono text-[11px] leading-relaxed text-amber-400/80">
              {articleFailureReason}
            </p>
          </EmptyState>
        ) : article === null ? (
          <EmptyState title="This scroll is not yet written">
            <p>
              Polaris has charted this star and written its brief. Its article is written in the second
              pass, which runs top-down once the whole constellation exists — reload in a moment.
            </p>
          </EmptyState>
        ) : (
          <section aria-label="Article" className="mystic-panel arch-border space-y-4 rounded-2xl p-6">
            <ArticleBody contentMd={article.contentMd} />
            {article.citations.length === 0 ? null : (
              <div className="border-t border-astral-gold/20 pt-3">
                <h2 className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Sources</h2>
                <ol className="mt-2 space-y-1.5">
                  {article.citations.map((citation, i) => (
                    <li key={`${i}-${citation.url}`} className="text-[11px] leading-relaxed text-slate-400">
                      <a
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-astral-gold hover:underline"
                      >
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
            // A node with no credible source cannot have questions, because every question must cite one
            // (docs/conflicts.md C80). Saying so beats an empty panel.
            <p className="text-xs text-slate-500">
              No trial for this scroll: its questions would have had no source to cite.
            </p>
          )
        ) : (
          <QuizPanel questions={quiz.questions} passMark={PASS_MARK_PERCENT} />
        )}
      </div>

      <aside className="space-y-4 lg:col-span-4">
        <div className="mystic-panel arch-border space-y-3 rounded-2xl p-5">
          <h2 className="border-b border-astral-gold/20 pb-2 font-serif text-sm font-bold text-astral-gold">
            Position in the Constellation
          </h2>
          <dl className="space-y-2 text-xs">
            <div>
              <dt className="font-mono uppercase tracking-wider text-slate-500">Ascends to</dt>
              <dd className="mt-0.5">
                {node.parent === null ? (
                  <span className="text-slate-400">the root of this constellation</span>
                ) : (
                  <Link href={`/topic/${node.parent.id}`} className="text-astral-gold hover:underline">
                    {node.parent.topic}
                  </Link>
                )}
              </dd>
            </div>
            <div>
              <dt className="font-mono uppercase tracking-wider text-slate-500">
                Descends to ({node.children.length})
              </dt>
              <dd className="mt-1 space-y-1">
                {node.children.length === 0 ? (
                  <span className="text-slate-400">nothing — this is a leaf</span>
                ) : (
                  node.children.map((child) => (
                    <Link
                      key={child.id}
                      href={`/topic/${child.id}`}
                      className="block truncate text-slate-300 hover:text-astral-gold"
                    >
                      {child.topic}
                    </Link>
                  ))
                )}
              </dd>
            </div>
          </dl>
          <Link
            href={`/tree/${node.runId}`}
            className="block border-t border-astral-gold/20 pt-3 font-serif text-xs text-astral-gold hover:underline"
          >
            ← See it in the constellation
          </Link>
        </div>
      </aside>
    </article>
  );
}

"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";
import { RunPanel } from "./run-panel";
import { TopicForm } from "./topic-form";

// Owns the one piece of state the form and the panel share: which run is on screen. The panel is keyed
// by runId so starting a second build remounts it with fresh polling state rather than merging two runs.
// The hero copy, status line and illustration are server-rendered slots, so this stays the only client
// boundary on the home page.
export function TreeBuilder({
  intro,
  status,
  illustration,
}: {
  intro?: ReactNode;
  status?: ReactNode;
  illustration?: ReactNode;
}) {
  const [runId, setRunId] = useState<string | undefined>(undefined);

  return (
    <div className="space-y-12">
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12">
        <div className="flex flex-col space-y-6 lg:col-span-7">
          {intro}
          <TopicForm onStarted={setRunId} />
          {status}
        </div>
        {illustration === undefined ? null : (
          <div className="relative flex items-center justify-center lg:col-span-5">{illustration}</div>
        )}
      </div>

      {runId === undefined ? null : (
        <section aria-label="Your learning map" className="space-y-4">
          <p className="text-[11px] text-faint">
            Link to this map:{" "}
            <Link href={`/tree/${runId}`} className="font-medium text-gold-ink hover:underline">
              /tree/{runId}
            </Link>
          </p>
          <RunPanel key={runId} runId={runId} />
        </section>
      )}
    </div>
  );
}

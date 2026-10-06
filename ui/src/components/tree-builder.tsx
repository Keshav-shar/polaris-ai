"use client";

import Link from "next/link";
import { useState } from "react";
import { RunPanel } from "./run-panel";
import { TopicForm } from "./topic-form";

// Owns the one piece of state the form and the panel share: which run is on screen. The panel is keyed
// by runId so starting a second build remounts it with fresh polling state rather than merging two runs.
export function TreeBuilder() {
  const [runId, setRunId] = useState<string | undefined>(undefined);

  return (
    <div className="space-y-6">
      <TopicForm onStarted={setRunId} />
      {runId === undefined ? null : (
        <>
          <p className="font-mono text-[11px] text-slate-500">
            Permalink:{" "}
            <Link href={`/tree/${runId}`} className="text-astral-gold hover:underline">
              /tree/{runId}
            </Link>
          </p>
          <RunPanel key={runId} runId={runId} />
        </>
      )}
    </div>
  );
}

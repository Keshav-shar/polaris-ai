"use client";

import { useEffect, useState } from "react";
import { apiBaseUrl, getHealth } from "../lib/api-client";

type Status =
  | { kind: "checking" }
  | { kind: "connected"; llmConfigured: boolean }
  | { kind: "unreachable" };

const DOT: Record<Status["kind"], string> = {
  checking: "bg-slate-500",
  connected: "bg-astral-gold",
  unreachable: "bg-red-500",
};

export function ApiStatus() {
  const [status, setStatus] = useState<Status>({ kind: "checking" });

  useEffect(() => {
    const controller = new AbortController();
    getHealth(controller.signal)
      .then((health) => setStatus({ kind: "connected", llmConfigured: health.llmConfigured }))
      .catch(() => {
        if (!controller.signal.aborted) setStatus({ kind: "unreachable" });
      });
    return () => controller.abort();
  }, []);

  let text: string;
  if (status.kind === "checking") text = "Consulting the observatory…";
  else if (status.kind === "connected")
    text = `Observatory connected — LLM key: ${status.llmConfigured ? "set" : "not set"}`;
  else text = `Observatory unreachable at ${apiBaseUrl}`;

  return (
    <p
      role="status"
      aria-live="polite"
      data-status={status.kind}
      className="flex items-center gap-2 font-mono text-[11px] text-slate-400"
    >
      <span className={`h-2 w-2 rounded-full ${DOT[status.kind]}`} aria-hidden="true" />
      {text}
    </p>
  );
}

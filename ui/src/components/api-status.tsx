"use client";

import { useEffect, useState } from "react";
import { apiBaseUrl, getHealth } from "../lib/api-client";

type Status =
  | { kind: "checking" }
  | { kind: "connected"; llmConfigured: boolean }
  | { kind: "unreachable" };

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
  if (status.kind === "checking") text = "Checking API…";
  else if (status.kind === "connected")
    text = `API connected — LLM key: ${status.llmConfigured ? "set" : "not set"}`;
  else text = `API unreachable at ${apiBaseUrl}`;

  return (
    <p role="status" aria-live="polite" data-status={status.kind}>
      {text}
    </p>
  );
}

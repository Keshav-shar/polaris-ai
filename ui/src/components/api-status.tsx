"use client";

import { useEffect, useState } from "react";
import { getHealth } from "../lib/api-client";

type Status =
  | { kind: "checking" }
  | { kind: "connected"; llmConfigured: boolean }
  | { kind: "unreachable" };

const DOT: Record<Status["kind"], string> = {
  checking: "bg-faint",
  connected: "bg-gold",
  unreachable: "bg-danger",
};

// One quiet line under the form: is the lesson builder ready? Learner wording; the API base URL and key
// state are developer detail and stay in the service logs and /health.
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
  if (status.kind === "checking") text = "Checking that Polaris is ready…";
  else if (status.kind === "connected")
    text = status.llmConfigured ? "Polaris is ready to teach." : "Polaris is online, but lesson writing isn't set up yet.";
  else text = "Polaris can't be reached right now.";

  return (
    <p
      role="status"
      aria-live="polite"
      data-status={status.kind}
      className="flex items-center gap-2 text-[11px] text-faint"
    >
      <span className={`h-2 w-2 rounded-full ${DOT[status.kind]}`} aria-hidden="true" />
      {text}
    </p>
  );
}

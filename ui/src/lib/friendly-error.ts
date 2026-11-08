import { ApiClientError } from "./api-client";

// The API's error messages are written for developers ("Request body is too large", "HTTP 503"). A learner
// gets one plain sentence keyed on the stable `error.code` instead; the raw message never reaches the page.
const BY_CODE: Record<string, string> = {
  run_in_progress: "Polaris is already building a few maps right now.",
  quota_exhausted: "Polaris has reached its lesson-writing limit for now.",
  rate_limited: "That was a lot of requests in a short time.",
  transport_unavailable: "Polaris can't reach its writing service at the moment.",
  llm_not_configured: "Polaris isn't fully set up yet, so it can't build maps.",
  run_not_found: "We couldn't find that map.",
  node_not_found: "We couldn't find that lesson.",
  invalid_request: "Something in that request didn't look right.",
  payload_too_large: "That was too long to send.",
  unauthenticated: "Please sign in to continue.",
  user_quota_exhausted: "You've built today's maximum number of learning maps.",
  service_unavailable: "Polaris can't reach one of its services right now.",
  // Reads hit this too (a lesson page, C143), so it must not say "save".
  storage_not_ready: "Polaris isn't fully set up yet, so this isn't available right now.",
};

// True when the right next step is to sign in, so a page can offer the link next to the message.
export function needsSignIn(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "unauthenticated";
}

const NETWORK = "Polaris can't be reached right now. Check your connection and try again.";

export function friendlyError(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof ApiClientError) {
    const base = BY_CODE[error.code] ?? fallback;
    const wait = error.retryAfterSeconds;
    if (error.status === 429 && wait !== undefined) return `${base} Please try again in ${waitText(wait)}.`;
    return base;
  }
  // fetch() rejects with a TypeError when the server cannot be reached at all.
  if (error instanceof TypeError) return NETWORK;
  return fallback;
}

function waitText(seconds: number): string {
  if (seconds < 90) return `${Math.ceil(seconds)} seconds`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return `${minutes} minutes`;
  return `about ${Math.round(minutes / 60)} hours`;
}

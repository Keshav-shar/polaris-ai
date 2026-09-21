import type { HealthResponse } from "./contract";

// Must be referenced literally so Next inlines it into the browser bundle.
export const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    value.status === "ok" &&
    "llmConfigured" in value &&
    typeof value.llmConfigured === "boolean"
  );
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch(`${apiBaseUrl}/health`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`Health check failed with HTTP ${res.status}`);
  const body: unknown = await res.json();
  if (!isHealthResponse(body)) throw new Error("Health check returned an unexpected body");
  return body;
}

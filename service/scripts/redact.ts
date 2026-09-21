import { type Env, isLlmConfigured, type LlmProvider, requireLlmEnv } from "../src/config/env";
import { redactSecrets } from "../src/shared/redact";

const PROFILES: readonly LlmProvider[] = ["primary", "fallback"];

// EVERY configured profile's key, not just the active one: with failover wired a single run can call
// both providers, so either key could come back in an error a provider echoed (docs/conflicts.md C58).
function llmKeys(env: Env): string[] {
  return PROFILES.filter((p) => isLlmConfigured(env, p)).map((p) => requireLlmEnv(env, p).apiKey);
}

// The shared failure path for every smoke script: name and message only (SDK errors carry request
// details in their body), with provider keys removed.
export function failureDetail(env: Env, error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return redactSecrets(raw, llmKeys(env));
}

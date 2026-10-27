import type { Env } from "../config/env";

// Every secret VALUE this process holds, for redaction by value (shared/redact.ts). One list, so a new
// secret is redacted everywhere by adding it here once - the old `llmKeys` covered only the LLM key, which
// left a Tavily, Supabase or AWS credential echoed by its own SDK error free to reach a stored failure
// reason (docs/conflicts.md C103). Empty and unset values are skipped: redacting "" would match everywhere.
export function secretValues(env: Env): string[] {
  const candidates = [
    env.LLM_API_KEY,
    env.TAVILY_API_KEY,
    env.SUPABASE_SERVICE_ROLE_KEY,
    env.AWS_ACCESS_KEY_ID,
    env.AWS_SECRET_ACCESS_KEY,
  ];
  return candidates.filter((value): value is string => typeof value === "string" && value.length > 0);
}

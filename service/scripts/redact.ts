import type { Env } from "../src/config/env";
import { secretValues } from "../src/composition/secrets";
import { failureReason } from "../src/shared/failure-reason";

// The shared failure path for every smoke script: name and message only (SDK errors carry request
// details in their body), with every configured secret removed. The formatting rule itself lives in
// shared/failure-reason.ts, so a script and a stored articleFailureReason read identically.
export function failureDetail(env: Env, error: unknown): string {
  return failureReason(error, secretValues(env));
}

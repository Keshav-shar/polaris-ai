import type { GenerateStructured, StructuredRequest } from "../../src/application/llm/structured";

// A GenerateStructured that records each request and returns whatever `result` yields (no schema check).
export function fakeGenerate(result: (request: StructuredRequest<never>) => Promise<unknown>) {
  const requests: StructuredRequest<never>[] = [];
  const generate = (async (request: StructuredRequest<never>) => {
    requests.push(request);
    return result(request);
  }) as GenerateStructured;
  return { generate, requests };
}

export type LogEntry = { level: "debug" | "info" | "warn" | "error"; msg: string; context?: Record<string, unknown> };

// `warnings` stays warn-only so existing assertions keep their meaning; `logs` has every level, which is
// what the build-estimate and halt paths need to assert on.
export function fakeLogger() {
  const warnings: { msg: string; context?: Record<string, unknown> }[] = [];
  const logs: LogEntry[] = [];
  const record =
    (level: LogEntry["level"]) =>
    (msg: string, context?: Record<string, unknown>): void => {
      logs.push({ level, msg, context });
      if (level === "warn") warnings.push({ msg, context });
    };
  return {
    logger: { debug: record("debug"), info: record("info"), warn: record("warn"), error: record("error") },
    warnings,
    logs,
  };
}

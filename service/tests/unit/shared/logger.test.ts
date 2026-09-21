import { describe, expect, it } from "vitest";
import { createLogger, type LogLevel } from "../../../src/shared/logger";

function capture(level: LogLevel) {
  const lines: { level: LogLevel; entry: Record<string, unknown> }[] = [];
  const logger = createLogger({
    level,
    write: (entryLevel, line) => lines.push({ level: entryLevel, entry: JSON.parse(line) }),
  });
  return { logger, lines };
}

describe("createLogger", () => {
  it("drops entries below the configured level", () => {
    const { logger, lines } = capture("warn");
    logger.info("ignored");
    logger.warn("kept");
    logger.error("kept too");
    expect(lines.map((l) => l.entry.msg)).toEqual(["kept", "kept too"]);
  });

  it("writes one JSON object with time, level, msg and context", () => {
    const { logger, lines } = capture("debug");
    logger.debug("hello", { runId: "r1" });
    expect(lines[0]?.entry).toMatchObject({ level: "debug", msg: "hello", runId: "r1" });
    expect(typeof lines[0]?.entry.time).toBe("string");
  });

  it("redacts secret-looking keys", () => {
    const { logger, lines } = capture("info");
    logger.info("config", { LLM_API_KEY: "sk-live", secretValue: "x", authorization: "Bearer y", model: "m" });
    expect(lines[0]?.entry).toMatchObject({
      LLM_API_KEY: "[redacted]",
      secretValue: "[redacted]",
      authorization: "[redacted]",
      model: "m",
    });
    expect(JSON.stringify(lines[0]?.entry)).not.toContain("sk-live");
  });

  it("serializes errors", () => {
    const { logger, lines } = capture("info");
    logger.error("boom", { err: new Error("bad") });
    expect(lines[0]?.entry.err).toMatchObject({ name: "Error", message: "bad" });
  });
});

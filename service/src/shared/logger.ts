export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(msg: string, context?: LogContext): void;
  info(msg: string, context?: LogContext): void;
  warn(msg: string, context?: LogContext): void;
  error(msg: string, context?: LogContext): void;
}

export type LogWriter = (level: LogLevel, line: string) => void;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEY = /key|secret|token|password|authorization/i;

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && value in LEVEL_ORDER;
}

const defaultWriter: LogWriter = (level, line) => {
  if (level === "warn" || level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
};

// Errors don't serialize with JSON.stringify, and secrets must never reach the logs.
function sanitize(context: LogContext): LogContext {
  const out: LogContext = {};
  for (const [k, v] of Object.entries(context)) {
    if (SECRET_KEY.test(k)) out[k] = "[redacted]";
    else if (v instanceof Error) out[k] = { name: v.name, message: v.message, stack: v.stack };
    else out[k] = v;
  }
  return out;
}

// Reads LOG_LEVEL itself (the one sanctioned exception to "getEnv() only in composition").
export function createLogger(options: { level?: LogLevel; write?: LogWriter } = {}): Logger {
  const envLevel = process.env.LOG_LEVEL;
  const level: LogLevel = options.level ?? (isLogLevel(envLevel) ? envLevel : "info");
  const write = options.write ?? defaultWriter;

  const log = (entryLevel: LogLevel, msg: string, context: LogContext = {}): void => {
    if (LEVEL_ORDER[entryLevel] < LEVEL_ORDER[level]) return;
    const entry = { time: new Date().toISOString(), level: entryLevel, msg, ...sanitize(context) };
    write(entryLevel, JSON.stringify(entry));
  };

  return {
    debug: (msg, context) => log("debug", msg, context),
    info: (msg, context) => log("info", msg, context),
    warn: (msg, context) => log("warn", msg, context),
    error: (msg, context) => log("error", msg, context),
  };
}

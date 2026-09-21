import type { ErrorRequestHandler, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { HTTP_RETRY_AFTER } from "../../../config/constants";
import { EnvError } from "../../../config/env";
import { QuotaExhaustedError } from "../../../domain/errors/quota-exhausted.error";
import { RunInProgressError } from "../../../domain/errors/run-in-progress.error";
import { RunNotFoundError } from "../../../domain/errors/run-not-found.error";
import { StructuredOutputError } from "../../../domain/errors/structured-output.error";
import type { ApiError } from "../../../domain/schemas/api.schema";
import type { Logger } from "../../../shared/logger";

function apiError(code: string, message: string, issues?: ApiError["error"]["issues"]): ApiError {
  return { error: issues ? { code, message, issues } : { code, message } };
}

// body-parser marks its own failures with `type` and an HTTP status.
function bodyParserType(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "type" in err && typeof err.type === "string") {
    return err.type;
  }
  return undefined;
}

// Retry-After is seconds, and must be at least 1: a sub-second value rounds to 0, which tells a client to
// retry immediately - the opposite of what a 429 means.
function retryAfter(res: Response, seconds: number): void {
  res.set("Retry-After", String(Math.max(1, Math.ceil(seconds))));
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json(apiError("not_found", `No route for ${req.method} ${req.path}`));
};

// The only place that maps errors to HTTP status codes.
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const parserType = bodyParserType(err);
    if (parserType === "entity.parse.failed") {
      res.status(400).json(apiError("invalid_json", "Request body is not valid JSON"));
      return;
    }
    if (parserType === "entity.too.large") {
      res.status(413).json(apiError("payload_too_large", "Request body is too large"));
      return;
    }
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      res.status(400).json(apiError("invalid_request", "Request failed validation", issues));
      return;
    }
    if (err instanceof RunNotFoundError) {
      res.status(404).json(apiError("run_not_found", err.message));
      return;
    }
    // Both 429s are refusals to spend LLM quota, not failures - the caller retries and gets a real answer.
    if (err instanceof RunInProgressError) {
      retryAfter(res, HTTP_RETRY_AFTER.RUN_IN_PROGRESS_SECONDS);
      res.status(429).json(apiError("run_in_progress", err.message));
      return;
    }
    if (err instanceof QuotaExhaustedError) {
      // A provider-stated wait beats our guess; without one, a daily quota is hours away, not seconds.
      retryAfter(
        res,
        err.retryAfterMs === undefined ? HTTP_RETRY_AFTER.QUOTA_FALLBACK_SECONDS : err.retryAfterMs / 1000,
      );
      res.status(429).json(apiError("quota_exhausted", err.message));
      return;
    }
    // The model answered, just not with usable JSON: an upstream failure, so 502 rather than 500.
    if (err instanceof StructuredOutputError) {
      logger.error("LLM returned unusable output", { method: req.method, path: req.path, err });
      res.status(502).json(apiError("structured_output_invalid", "The language model returned unusable output"));
      return;
    }
    // Misconfiguration, not a bad request: the message names the missing variables and echoes no values
    // (config/env.ts), so returning it is what makes the 503 actionable.
    if (err instanceof EnvError) {
      res.status(503).json(apiError("llm_not_configured", err.message));
      return;
    }
    logger.error("Unhandled request error", { method: req.method, path: req.path, err });
    res.status(500).json(apiError("internal", "Internal server error"));
  };
}

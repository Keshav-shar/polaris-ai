import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { EnvError } from "../../../../src/config/env";
import { QuotaExhaustedError } from "../../../../src/domain/errors/quota-exhausted.error";
import { RunInProgressError } from "../../../../src/domain/errors/run-in-progress.error";
import { RunNotFoundError } from "../../../../src/domain/errors/run-not-found.error";
import { StructuredOutputError } from "../../../../src/domain/errors/structured-output.error";
import { createErrorHandler } from "../../../../src/interfaces/http/middleware/error-handler.middleware";
import type { LogContext, Logger } from "../../../../src/shared/logger";

function fakeResponse() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headersSent: false,
    headers: {} as Record<string, string>,
  };
  const response = {
    get headersSent() {
      return res.headersSent;
    },
    set(name: string, value: string) {
      res.headers[name] = value;
      return response;
    },
    status(code: number) {
      res.statusCode = code;
      return response;
    },
    json(body: unknown) {
      res.body = body;
      return response;
    },
  };
  return { res, response: response as unknown as Response };
}

function fakeLogger() {
  const error = vi.fn<(msg: string, context?: LogContext) => void>();
  const logger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error };
  return { logger, error };
}

const req = { method: "POST", path: "/api/trees" } as Request;
const next = vi.fn() as unknown as NextFunction;

describe("error handler", () => {
  it("maps a ZodError to 400 with issues", () => {
    const { logger, error: logError } = fakeLogger();
    const { res, response } = fakeResponse();
    const error = z.object({ prompt: z.string() }).safeParse({}).error;
    createErrorHandler(logger)(error, req, response, next);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: { code: "invalid_request", issues: [{ path: "prompt" }] } });
    expect(logError).not.toHaveBeenCalled();
  });

  it("maps an unknown run to 404", () => {
    const { logger } = fakeLogger();
    const { res, response } = fakeResponse();
    createErrorHandler(logger)(new RunNotFoundError("11111111-1111-4111-8111-111111111111"), req, response, next);
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "run_not_found" } });
  });

  it("maps a refused concurrent run to 429 with Retry-After", () => {
    const { logger, error: logError } = fakeLogger();
    const { res, response } = fakeResponse();
    createErrorHandler(logger)(new RunInProgressError(1, 1), req, response, next);
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ error: { code: "run_in_progress" } });
    expect(Number(res.headers["Retry-After"])).toBeGreaterThan(0);
    // A cost guard doing its job is not an incident.
    expect(logError).not.toHaveBeenCalled();
  });

  it("maps an exhausted quota to 429 and honours the provider's own wait", () => {
    const { logger } = fakeLogger();
    const { res, response } = fakeResponse();
    createErrorHandler(logger)(new QuotaExhaustedError("gemini-3.6-flash", 45_000), req, response, next);
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ error: { code: "quota_exhausted" } });
    expect(res.headers["Retry-After"]).toBe("45");
  });

  it("falls back to a long wait when the provider states none", () => {
    const { logger } = fakeLogger();
    const { res, response } = fakeResponse();
    createErrorHandler(logger)(new QuotaExhaustedError("gemini-3.6-flash"), req, response, next);
    // A daily quota is hours away; telling a client to retry in a second would just burn requests.
    expect(Number(res.headers["Retry-After"])).toBeGreaterThan(60);
  });

  it("maps unusable model output to 502 without leaking the raw output", () => {
    const { logger, error: logError } = fakeLogger();
    const { res, response } = fakeResponse();
    createErrorHandler(logger)(new StructuredOutputError("expand", "{not json at all"), req, response, next);
    expect(res.statusCode).toBe(502);
    expect(res.body).toMatchObject({ error: { code: "structured_output_invalid" } });
    expect(JSON.stringify(res.body)).not.toContain("not json at all");
    expect(logError).toHaveBeenCalledOnce();
  });

  it("maps a missing LLM configuration to 503 and says which variables are missing", () => {
    const { logger } = fakeLogger();
    const { res, response } = fakeResponse();
    createErrorHandler(logger)(new EnvError("LLM is not configured. Set LLM_API_KEY in service/.env"), req, response, next);
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ error: { code: "llm_not_configured" } });
    expect(JSON.stringify(res.body)).toContain("LLM_API_KEY");
  });

  it("maps an unknown error to a generic 500 and logs the details", () => {
    const { logger, error: logError } = fakeLogger();
    const { res, response } = fakeResponse();
    createErrorHandler(logger)(new Error("database password leaked in message"), req, response, next);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: { code: "internal", message: "Internal server error" } });
    expect(JSON.stringify(res.body)).not.toContain("password");
    expect(logError).toHaveBeenCalledOnce();
  });
});

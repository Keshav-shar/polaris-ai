import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { validateBody, validateParams } from "../../../../src/interfaces/http/middleware/validate.middleware";

const Body = z.object({ prompt: z.string().min(1), maxDepth: z.number().optional() });

function run(middleware: ReturnType<typeof validateBody>["middleware"], req: Partial<Request>) {
  const res = { locals: {} } as Response;
  const next = vi.fn() as unknown as NextFunction;
  middleware(req as Request, res, next);
  return { res, next: next as unknown as ReturnType<typeof vi.fn> };
}

describe("validate middleware", () => {
  it("hands the parsed body to the handler through its own reader", () => {
    const body = validateBody(Body);
    const { res, next } = run(body.middleware, { body: { prompt: "photosynthesis", maxDepth: 2 } });

    expect(next).toHaveBeenCalledWith();
    expect(body.read(res)).toEqual({ prompt: "photosynthesis", maxDepth: 2 });
  });

  it("forwards a ZodError to next instead of answering itself", () => {
    const body = validateBody(Body);
    const { next } = run(body.middleware, { body: { prompt: "" } });

    // Status mapping lives in error-handler.middleware.ts alone; this one only reports the failure.
    expect(next).toHaveBeenCalledOnce();
    expect(vi.mocked(next).mock.calls[0]?.[0]).toBeInstanceOf(z.ZodError);
  });

  it("forwards a ZodError when the body is missing entirely", () => {
    const body = validateBody(Body);
    const { next } = run(body.middleware, {});
    expect(vi.mocked(next).mock.calls[0]?.[0]).toBeInstanceOf(z.ZodError);
  });

  it("reads params separately from the body on the same response", () => {
    const body = validateBody(Body);
    const params = validateParams(z.object({ runId: z.uuid() }));
    const runId = "11111111-1111-4111-8111-111111111111";
    const req = { body: { prompt: "x" }, params: { runId } } as unknown as Request;
    const res = { locals: {} } as Response;
    const next = vi.fn() as unknown as NextFunction;

    body.middleware(req, res, next);
    params.middleware(req, res, next);

    // Two validators on one request must not overwrite each other's slot.
    expect(body.read(res)).toEqual({ prompt: "x" });
    expect(params.read(res)).toEqual({ runId });
  });
});

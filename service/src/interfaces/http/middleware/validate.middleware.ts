import type { Request, RequestHandler, Response } from "express";
import type { z } from "zod";

// A schema plus the two halves of using it: the middleware that parses, and a typed reader for the handler.
// Pairing them is what makes the parsed value typed at the call site without a second parse or a cast in
// the route.
export type Validated<T extends z.ZodType> = {
  middleware: RequestHandler;
  read(res: Response): z.infer<T>;
};

let sequence = 0;

// Express 5 exposes req.params through a getter and req.body is `unknown` until something narrows it, so
// the parsed value is carried on res.locals under a key only this validator knows. A ZodError goes to
// next(), where error-handler.middleware.ts turns it into 400 invalid_request - the one place that maps
// errors to status codes.
function validate<T extends z.ZodType>(schema: T, pick: (req: Request) => unknown): Validated<T> {
  const key = `validated:${(sequence += 1)}`;
  return {
    middleware(req, res, next) {
      const result = schema.safeParse(pick(req));
      if (!result.success) {
        next(result.error);
        return;
      }
      (res.locals as Record<string, unknown>)[key] = result.data;
      next();
    },
    // Safe only because `key` is private to this validator and its middleware runs before the handler.
    read(res) {
      return (res.locals as Record<string, unknown>)[key] as z.infer<T>;
    },
  };
}

export function validateBody<T extends z.ZodType>(schema: T): Validated<T> {
  return validate(schema, (req) => req.body);
}

export function validateParams<T extends z.ZodType>(schema: T): Validated<T> {
  return validate(schema, (req) => req.params);
}

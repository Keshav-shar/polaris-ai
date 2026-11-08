import type { RequestHandler, Response } from "express";
import type { AuthVerifierPort } from "../../../application/ports/auth-verifier.port";
import { UnauthenticatedError } from "../../../domain/errors/unauthenticated.error";
import { Caller } from "../../../domain/schemas/caller.schema";

const CALLER_KEY = "auth:caller";
// A Supabase access token is ~1 KB. Anything far larger is not one, and is refused before any crypto runs.
const MAX_TOKEN_CHARS = 4096;

// Establishes WHO is calling, never what they may do: that is each use-case's rule (C105). No header = an
// anonymous caller, which a public read allows and a build refuses. A header that is present but not a valid
// token is a 401 - never silently downgraded to anonymous, which would turn an expired session into confusing
// 404s. With auth off (`verifier` undefined, no Supabase) any header is ignored.
export function createAuthMiddleware(verifier: AuthVerifierPort | undefined): RequestHandler {
  return async (req, res, next) => {
    const header = req.get("authorization");
    if (verifier === undefined || header === undefined) {
      next();
      return;
    }
    const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header);
    if (match === null || match[1] === undefined || match[1].length > MAX_TOKEN_CHARS) {
      next(new UnauthenticatedError("The sign-in token is malformed. Please sign in again."));
      return;
    }
    // Throws DependencyUnavailableError (503) if the key set cannot be fetched; Express 5 forwards it.
    const caller = await verifier.verify(match[1]);
    if (caller === undefined) {
      next(new UnauthenticatedError("Your sign-in has expired. Please sign in again."));
      return;
    }
    (res.locals as Record<string, unknown>)[CALLER_KEY] = caller;
    next();
  };
}

// The verified caller, or undefined for an anonymous request. Re-validated rather than cast: res.locals is
// shared, untyped state.
export function readCaller(res: Response): Caller | undefined {
  const parsed = Caller.safeParse((res.locals as Record<string, unknown>)[CALLER_KEY]);
  return parsed.success ? parsed.data : undefined;
}

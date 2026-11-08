import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { AuthVerifierPort } from "../../../../src/application/ports/auth-verifier.port";
import { createApp } from "../../../../src/interfaces/http/app";
import { createAuthMiddleware, readCaller } from "../../../../src/interfaces/http/middleware/auth.middleware";
import { createLogger } from "../../../../src/shared/logger";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const verifier: AuthVerifierPort = {
  verify: async (token) => (token === "good.token.sig" ? { userId } : undefined),
};

let server: Server | undefined;
afterEach(() => new Promise<void>((resolve) => (server === undefined ? resolve() : server.close(() => resolve()))));

// The middleware in front of a route that echoes who it thinks is calling, behind the real error handler.
async function serve(v: AuthVerifierPort | undefined): Promise<string> {
  const api = express.Router();
  api.use(createAuthMiddleware(v));
  api.get("/whoami", (_req, res) => {
    res.json({ caller: readCaller(res) ?? null });
  });
  const app = createApp({
    corsOrigin: "http://localhost:3000",
    version: "1",
    llmConfigured: true,
    logger: createLogger({ write: () => {} }),
    api,
  });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return `http://127.0.0.1:${address.port}/api/whoami`;
}

describe("auth middleware (C105)", () => {
  it("treats a request with no header as anonymous", async () => {
    const res = await fetch(await serve(verifier));
    expect(await res.json()).toEqual({ caller: null });
  });

  it("sets the caller from a valid bearer token", async () => {
    const res = await fetch(await serve(verifier), { headers: { Authorization: "Bearer good.token.sig" } });
    expect(await res.json()).toEqual({ caller: { userId } });
  });

  it("answers 401 for an invalid or malformed token rather than downgrading to anonymous", async () => {
    const url = await serve(verifier);
    for (const header of ["Bearer bad.token.sig", "Basic abc", "Bearer ", `Bearer ${"a".repeat(5000)}`]) {
      const res = await fetch(url, { headers: { Authorization: header } });
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe("Bearer");
      expect(await res.json()).toMatchObject({ error: { code: "unauthenticated" } });
    }
  });

  it("ignores any header when auth is off", async () => {
    const res = await fetch(await serve(undefined), { headers: { Authorization: "Bearer whatever" } });
    expect(await res.json()).toEqual({ caller: null });
  });
});

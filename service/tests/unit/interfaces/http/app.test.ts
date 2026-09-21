import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError, HealthResponse } from "../../../../src/domain/schemas/api.schema";
import { createApp } from "../../../../src/interfaces/http/app";
import { createLogger } from "../../../../src/shared/logger";

const ALLOWED_ORIGIN = "http://localhost:3000";
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp({
    corsOrigin: ALLOWED_ORIGIN,
    version: "9.9.9",
    llmConfigured: false,
    logger: createLogger({ write: () => {} }),
  });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

describe("GET /health", () => {
  it("returns a schema-valid health body", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(HealthResponse.parse(await res.json())).toEqual({
      status: "ok",
      service: "polaris-service",
      version: "9.9.9",
      llmConfigured: false,
    });
  });
});

describe("CORS", () => {
  it("sends the allow-origin header to the configured origin", async () => {
    const res = await fetch(`${baseUrl}/health`, { headers: { Origin: ALLOWED_ORIGIN } });
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
  });

  it("does not send it to any other origin", async () => {
    const res = await fetch(`${baseUrl}/health`, { headers: { Origin: "http://evil.test" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("errors", () => {
  it("returns a JSON 404 for unknown routes", async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
    expect(ApiError.parse(await res.json()).error.code).toBe("not_found");
  });

  it("returns 400 invalid_json for a malformed JSON body", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad",
    });
    expect(res.status).toBe(400);
    expect(ApiError.parse(await res.json()).error.code).toBe("invalid_json");
  });

  it("returns 413 for a body over 10 kb", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(11 * 1024) }),
    });
    expect(res.status).toBe(413);
    expect(ApiError.parse(await res.json()).error.code).toBe("payload_too_large");
  });
});

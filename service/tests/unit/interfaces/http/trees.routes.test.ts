import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GetTree } from "../../../../src/application/use-cases/get-tree.use-case";
import type { StartTreeBuild } from "../../../../src/application/use-cases/start-tree-build.use-case";
import { EnvError } from "../../../../src/config/env";
import { QuotaExhaustedError } from "../../../../src/domain/errors/quota-exhausted.error";
import { RunInProgressError } from "../../../../src/domain/errors/run-in-progress.error";
import { RunNotFoundError } from "../../../../src/domain/errors/run-not-found.error";
import { StructuredOutputError } from "../../../../src/domain/errors/structured-output.error";
import { ApiError, StartTreeResponse, TreeResponse } from "../../../../src/domain/schemas/api.schema";
import { createApp } from "../../../../src/interfaces/http/app";
import { createTreesRouter, type TreesRoutesDeps } from "../../../../src/interfaces/http/routes/trees.routes";
import { createLogger } from "../../../../src/shared/logger";

const runId = "11111111-1111-4111-8111-111111111111";

const treeResponse: TreeResponse = {
  run: { runId, topic: "photosynthesis", maxDepth: 1, status: "constructed" },
  tree: {
    id: runId,
    topic: "photosynthesis",
    depth: 0,
    brief: "Plants make sugar from light.",
    status: "done",
    children: [],
  },
  stats: { nodesDone: 1, nodesFailed: 0, nodesSkipped: 0, articlesDone: 0, articlesFailed: 0 },
};

const servers: Server[] = [];

// The router under test behind the real app, so CORS, the JSON body limit and the error handler are the
// ones that will run in production. Only the use-cases are faked - no LLM, no queue.
async function serve(deps: Partial<TreesRoutesDeps> = {}): Promise<string> {
  const api = express.Router();
  api.use(
    "/trees",
    createTreesRouter({
      startTreeBuild: deps.startTreeBuild ?? (() => ({ execute: async () => ({ runId }) })),
      getTree: deps.getTree ?? (() => ({ execute: async () => treeResponse })),
    }),
  );
  const app = createApp({
    corsOrigin: "http://localhost:3000",
    version: "9.9.9",
    llmConfigured: true,
    logger: createLogger({ write: () => {} }),
    api,
  });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const post = (baseUrl: string, body: unknown): Promise<Response> =>
  fetch(`${baseUrl}/api/trees`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// One accessor that throws, for every error the use-cases can raise out of a request.
const throwing =
  (error: unknown): (() => StartTreeBuild) =>
  () => ({
    execute: async () => {
      throw error;
    },
  });

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((s) => new Promise<void>((resolve, reject) => s.close((e) => (e ? reject(e) : resolve())))),
  );
});

describe("POST /api/trees", () => {
  it("answers 202 with the run id, without waiting for the build", async () => {
    const baseUrl = await serve();
    const res = await post(baseUrl, { prompt: "teach me photosynthesis" });

    // 202, not 201: the tree does not exist yet, the caller polls for it.
    expect(res.status).toBe(202);
    expect(StartTreeResponse.parse(await res.json())).toEqual({ runId });
  });

  it("passes an explicit maxDepth through to the use-case and omits it otherwise", async () => {
    const execute = vi.fn<StartTreeBuild["execute"]>(async () => ({ runId }));
    const baseUrl = await serve({ startTreeBuild: () => ({ execute }) });

    await post(baseUrl, { prompt: "teach me photosynthesis", maxDepth: 2 });
    expect(execute).toHaveBeenLastCalledWith("teach me photosynthesis", { maxDepth: 2 });

    // Omitted means "whatever the parser infers", which is not the same as any particular number.
    await post(baseUrl, { prompt: "teach me photosynthesis" });
    expect(execute).toHaveBeenLastCalledWith("teach me photosynthesis", undefined);
  });

  it.each([
    ["a missing prompt", {}],
    ["an empty prompt", { prompt: "   " }],
    ["a prompt over 500 characters", { prompt: "x".repeat(501) }],
    ["maxDepth 0", { prompt: "x", maxDepth: 0 }],
    ["maxDepth over the ceiling", { prompt: "x", maxDepth: 7 }],
    ["a non-integer maxDepth", { prompt: "x", maxDepth: 1.5 }],
  ])("rejects %s with 400", async (_label, body) => {
    const baseUrl = await serve();
    const res = await post(baseUrl, body);
    expect(res.status).toBe(400);
    expect(ApiError.parse(await res.json()).error.code).toBe("invalid_request");
  });

  it("returns 429 with Retry-After while another run is constructing", async () => {
    const baseUrl = await serve({ startTreeBuild: throwing(new RunInProgressError(1, 1)) });
    const res = await post(baseUrl, { prompt: "x" });

    expect(res.status).toBe(429);
    expect(ApiError.parse(await res.json()).error.code).toBe("run_in_progress");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("returns 429 with Retry-After when the LLM daily quota is gone", async () => {
    const baseUrl = await serve({
      startTreeBuild: throwing(new QuotaExhaustedError("gemini-3.6-flash", 60_000)),
    });
    const res = await post(baseUrl, { prompt: "x" });

    expect(res.status).toBe(429);
    expect(ApiError.parse(await res.json()).error.code).toBe("quota_exhausted");
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it("returns 502 when the parser output cannot be repaired", async () => {
    const baseUrl = await serve({ startTreeBuild: throwing(new StructuredOutputError("parser", "{oops")) });
    const res = await post(baseUrl, { prompt: "x" });

    expect(res.status).toBe(502);
    expect(ApiError.parse(await res.json()).error.code).toBe("structured_output_invalid");
  });

  it("returns 503 when the LLM is not configured", async () => {
    // The accessor itself throws: composition builds the stack lazily so the process can still serve.
    const baseUrl = await serve({
      startTreeBuild: () => {
        throw new EnvError("LLM is not configured. Set LLM_API_KEY in service/.env (see docs/setup.md).");
      },
    });
    const res = await post(baseUrl, { prompt: "x" });

    expect(res.status).toBe(503);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe("llm_not_configured");
    expect(body.error.message).toContain("LLM_API_KEY");
  });

  it("still answers /health when the LLM is not configured", async () => {
    const baseUrl = await serve({
      startTreeBuild: () => {
        throw new EnvError("nope");
      },
    });
    expect((await fetch(`${baseUrl}/health`)).status).toBe(200);
  });
});

describe("GET /api/trees/:runId", () => {
  it("returns a schema-valid tree response", async () => {
    const baseUrl = await serve();
    const res = await fetch(`${baseUrl}/api/trees/${runId}`);

    expect(res.status).toBe(200);
    expect(TreeResponse.parse(await res.json())).toEqual(treeResponse);
  });

  it("rejects a malformed run id with 400 before it reaches the repository", async () => {
    const execute = vi.fn<GetTree["execute"]>(async () => treeResponse);
    const baseUrl = await serve({ getTree: () => ({ execute }) });
    const res = await fetch(`${baseUrl}/api/trees/not-a-uuid`);

    expect(res.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns 404 for a well-formed but unknown run id", async () => {
    const baseUrl = await serve({
      getTree: () => ({
        execute: async () => {
          throw new RunNotFoundError(runId);
        },
      }),
    });
    const res = await fetch(`${baseUrl}/api/trees/${runId}`);

    expect(res.status).toBe(404);
    expect(ApiError.parse(await res.json()).error.code).toBe("run_not_found");
  });
});

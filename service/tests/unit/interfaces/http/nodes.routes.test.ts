import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { BoostArticle } from "../../../../src/application/use-cases/boost-article.use-case";
import type { GetNode } from "../../../../src/application/use-cases/get-node.use-case";
import { NodeNotFoundError } from "../../../../src/domain/errors/node-not-found.error";
import { ApiError, BoostResponse } from "../../../../src/domain/schemas/api.schema";
import { createApp } from "../../../../src/interfaces/http/app";
import { createNodesRouter } from "../../../../src/interfaces/http/routes/nodes.routes";
import { createLogger } from "../../../../src/shared/logger";

const nodeId = "22222222-2222-4222-8222-222222222222";
const servers: Server[] = [];

const unusedGetNode = (): GetNode => ({
  execute: async () => {
    throw new Error("not used");
  },
});

// The router behind the real app, so the error handler and its status map are the ones that ship.
async function serve(boostArticle: () => BoostArticle): Promise<string> {
  const api = express.Router();
  api.use("/nodes", createNodesRouter({ getNode: unusedGetNode, boostArticle }));
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

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

describe("POST /api/nodes/:nodeId/boost (C128)", () => {
  it("answers 202 with the boost status", async () => {
    const calls: string[] = [];
    const base = await serve(() => ({
      execute: async (id) => (calls.push(id), { nodeId: id, status: "promoted" as const }),
    }));
    const res = await fetch(`${base}/api/nodes/${nodeId}/boost`, { method: "POST" });
    expect(res.status).toBe(202);
    expect(BoostResponse.parse(await res.json())).toEqual({ nodeId, status: "promoted" });
    expect(calls).toEqual([nodeId]);
  });

  it("answers 404 node_not_found for an unknown node", async () => {
    const base = await serve(() => ({
      execute: async (id) => {
        throw new NodeNotFoundError(id);
      },
    }));
    const res = await fetch(`${base}/api/nodes/${nodeId}/boost`, { method: "POST" });
    expect(res.status).toBe(404);
    expect(ApiError.parse(await res.json()).error.code).toBe("node_not_found");
  });

  it("answers 400 for a malformed id without calling the use-case", async () => {
    let called = false;
    const base = await serve(() => ({
      execute: async (id) => ((called = true), { nodeId: id, status: "promoted" as const }),
    }));
    const res = await fetch(`${base}/api/nodes/not-a-uuid/boost`, { method: "POST" });
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });
});

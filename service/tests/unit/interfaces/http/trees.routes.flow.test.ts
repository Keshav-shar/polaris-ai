import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError, StartTreeResponse, TreeResponse } from "../../../../src/domain/schemas/api.schema";
import { createApp } from "../../../../src/interfaces/http/app";
import { createTreesRouter } from "../../../../src/interfaces/http/routes/trees.routes";
import { createLogger } from "../../../../src/shared/logger";
import { buildHarness, type HarnessOptions } from "../../../fixtures/build-harness";

// The whole construction path behind the real routes, with a fake expander in place of the LLM: the
// offline twin of the Phase 7 Verify step (curl POST, then poll GET until the run leaves `constructing`).
let server: Server | undefined;

async function serve(options: HarnessOptions = {}) {
  const harness = buildHarness(options);
  const api = express.Router();
  api.use(
    "/trees",
    createTreesRouter({
      // Mirrors composition/container.ts: kickoff ensures the worker is draining, the read path does not.
      startTreeBuild: () => {
        harness.worker.start();
        return harness.startTreeBuild;
      },
      getTree: () => harness.getTree,
    }),
  );
  const app = createApp({
    corsOrigin: "http://localhost:3000",
    version: "9.9.9",
    llmConfigured: true,
    logger: createLogger({ write: () => {} }),
    api,
  });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { harness, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

async function start(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/trees`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Exactly what the UI will do in Phase 8. Bounded, so a stuck run fails the test instead of hanging it.
async function poll(baseUrl: string, runId: string): Promise<TreeResponse> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const res = await fetch(`${baseUrl}/api/trees/${runId}`);
    expect(res.status).toBe(200);
    const body = TreeResponse.parse(await res.json());
    if (body.run.status !== "constructing") return body;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`run ${runId} never left constructing`);
}

afterEach(async () => {
  const current = server;
  server = undefined;
  if (current !== undefined) {
    await new Promise<void>((resolve, reject) => current.close((e) => (e ? reject(e) : resolve())));
  }
});

describe("tree build over HTTP", () => {
  it("builds a whole tree from one POST and serves it from GET", async () => {
    const { baseUrl } = await serve({ maxDepth: 2, breadth: 2 });

    const started = await start(baseUrl, { prompt: "photosynthesis" });
    expect(started.status).toBe(202);
    const { runId } = StartTreeResponse.parse(await started.json());

    const body = await poll(baseUrl, runId);
    expect(body.run).toMatchObject({ runId, topic: "photosynthesis", maxDepth: 2, status: "constructed" });
    // 1 root + 2 children + 4 grandchildren, and the leaf layer is forced childless.
    expect(body.stats.nodesDone).toBe(7);
    expect(body.tree?.children).toHaveLength(2);
    expect(body.tree?.children[0]?.children[0]?.children).toEqual([]);
  });

  it("serves a partial tree with a halt reason when the quota runs out mid-build", async () => {
    // The fake provider dies after the root, so the frontier is known but never expanded.
    const { baseUrl } = await serve({ maxDepth: 2, breadth: 3, quotaAfter: 1 });

    const started = await start(baseUrl, { prompt: "photosynthesis" });
    const { runId } = StartTreeResponse.parse(await started.json());
    const body = await poll(baseUrl, runId);

    expect(body.run.status).toBe("halted");
    expect(body.run.haltReason).toBeDefined();
    // A partial tree is the point: the discovered children are still there, marked blocked (C54).
    expect(body.tree?.children).toHaveLength(3);
    expect(body.tree?.children.map((child) => child.status)).toEqual(["blocked", "blocked", "blocked"]);
  });

  it("refuses a second build while the first is still constructing", async () => {
    // A slow expander keeps the first run in flight long enough for the second POST to land on it.
    const { baseUrl } = await serve({ maxDepth: 2, breadth: 2, delayMs: 30, maxConcurrentRuns: 1 });

    const first = await start(baseUrl, { prompt: "photosynthesis" });
    expect(first.status).toBe(202);
    const second = await start(baseUrl, { prompt: "black holes" });

    expect(second.status).toBe(429);
    expect(ApiError.parse(await second.json()).error.code).toBe("run_in_progress");
    expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);

    // ...and the slot frees once that run finishes, rather than blocking the API for good.
    const { runId } = StartTreeResponse.parse(await first.json());
    await poll(baseUrl, runId);
    expect((await start(baseUrl, { prompt: "black holes" })).status).toBe(202);
  });

  it("caps a run at MAX_NODES_PER_RUN and says how much it skipped", async () => {
    // Balanced cap for 7 nodes at depth 2 is 2 (1 + 2 + 4), so the full 3-wide tree is cut evenly (C101).
    const { baseUrl } = await serve({ maxDepth: 2, breadth: 3, maxNodesPerRun: 7 });

    const started = await start(baseUrl, { prompt: "photosynthesis" });
    const { runId } = StartTreeResponse.parse(await started.json());
    const body = await poll(baseUrl, runId);

    expect(body.run.status).toBe("constructed");
    expect(body.stats.nodesDone).toBe(7);
    // Above 0 the UI must say the tree is narrower than maxDepth implies (docs/conflicts.md C60).
    expect(body.stats.nodesSkipped).toBeGreaterThan(0);
  });
});

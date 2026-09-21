# http/

**Purpose:** Express application bootstrap.

**May depend on:** interfaces/http/*, application/use-cases, composition.

**Must not depend on:** infrastructure directly.

**Contents:**
- `app.ts` — `createApp({corsOrigin, version, llmConfigured, logger, api?})`: CORS limited to `CORS_ORIGIN`, `express.json({ limit: "10kb" })`, `GET /health`, the optional `api` router mounted at `/api`, 404, error handler (Phase 2; `api` added in Phase 7). It constructs nothing itself — the router is built in `composition/`
- `server.ts` — `dotenv`, `getEnv()`, `createContainer(env, logger)`, `api.use("/trees", createTreesRouter(container))`, `createApp().listen(API_PORT)`, and `SIGINT`/`SIGTERM` → `server.close()` + `container.shutdown()` so in-flight expansions finish (Phase 2; container + shutdown Phase 7)

**Design notes:**
- The container is lazy: `createApp` must be reachable even when the LLM is unconfigured, because answering **503** is the API's job in that state (docs/conflicts.md C64).

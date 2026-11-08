import dotenv from "dotenv";
import { Router } from "express";
import { createContainer } from "../../composition/container";
import { StorageNotReadyError } from "../../domain/errors/storage-not-ready.error";
import { getEnv } from "../../config/env";
import { createLogger } from "../../shared/logger";
import { createApp } from "./app";
import { createAuthMiddleware } from "./middleware/auth.middleware";
import { createNodesRouter } from "./routes/nodes.routes";
import { createRunsRouter } from "./routes/runs.routes";
import { createTreesRouter } from "./routes/trees.routes";

dotenv.config({ quiet: true });

const env = getEnv();
const logger = createLogger({ level: env.LOG_LEVEL });
const container = createContainer(env, logger);
const llmConfigured = container.llmConfigured;

const api = Router();
// Before every router: establishes who is calling; each use-case decides what they may do (C105).
api.use(createAuthMiddleware(container.authVerifier));
api.use("/trees", createTreesRouter(container));
api.use("/runs", createRunsRouter(container));
api.use("/nodes", createNodesRouter(container));

const app = createApp({
  corsOrigin: env.CORS_ORIGIN,
  version: process.env.npm_package_version ?? "0.0.0",
  llmConfigured,
  authRequired: container.authRequired,
  logger,
  api,
});

const server = app.listen(env.API_PORT, () => {
  // Configuration flags only; key values are never logged.
  logger.info("Polaris API listening", {
    url: `http://localhost:${env.API_PORT}`,
    corsOrigin: env.CORS_ORIGIN,
    llmConfigured,
    queueMode: env.QUEUE_MODE,
    storage: container.authRequired ? "postgres" : "memory",
    authRequired: container.authRequired,
  });
  if (!container.authRequired) {
    logger.warn("auth is OFF: SUPABASE_URL is not set, so runs are in memory and anyone can build", {
      note: "fine for a local run; never deploy like this (docs/setup.md item 6)",
    });
  }
  // Not awaited before listen: an unreachable database must not keep /health from answering. The schema check
  // runs first, so an unmigrated database is reported once, plainly, with the command that fixes it.
  // The recovery runs whatever the check says: a schema missing only the newest tables still has `runs`, and an
  // interrupted run left `constructing` would block MAX_CONCURRENT_RUNS (C143).
  const recover = (): Promise<void> =>
    container
      .recoverInterruptedRuns()
      .then((halted) => {
        if (halted > 0) logger.warn("halted runs interrupted by the last restart", { halted });
      })
      .catch((err: unknown) => logger.error("could not halt interrupted runs at startup", { err }));
  container
    .checkStorage()
    .catch((err: unknown) => {
      if (err instanceof StorageNotReadyError) {
        logger.error("Supabase is configured but part of its schema is missing: requests that touch it answer 503", {
          fix: "npm --prefix service run db:push (after `npx supabase link --project-ref <ref>` once)",
          detail: err.detail,
        });
        return;
      }
      logger.error("could not check the database at startup", { err });
    })
    .then(recover);
});

// The worker holds the run in memory, so a restart loses it either way; stopping it still lets in-flight
// expansions finish and land in the tree instead of being cut mid-call (resume arrives with Postgres).
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    logger.info("shutting down", { signal });
    server.close(() => {
      void container.shutdown().then(() => process.exit(0));
    });
  });
}

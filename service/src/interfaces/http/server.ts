import dotenv from "dotenv";
import { Router } from "express";
import { createContainer } from "../../composition/container";
import { getEnv } from "../../config/env";
import { createLogger } from "../../shared/logger";
import { createApp } from "./app";
import { createNodesRouter } from "./routes/nodes.routes";
import { createRunsRouter } from "./routes/runs.routes";
import { createTreesRouter } from "./routes/trees.routes";

dotenv.config({ quiet: true });

const env = getEnv();
const logger = createLogger({ level: env.LOG_LEVEL });
const container = createContainer(env, logger);
const llmConfigured = container.llmConfigured;

const api = Router();
api.use("/trees", createTreesRouter(container));
api.use("/runs", createRunsRouter(container));
api.use("/nodes", createNodesRouter(container));

const app = createApp({
  corsOrigin: env.CORS_ORIGIN,
  version: process.env.npm_package_version ?? "0.0.0",
  llmConfigured,
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
  });
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

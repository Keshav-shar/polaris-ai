import cors from "cors";
import express, { type Express, type Router } from "express";
import type { HealthResponse } from "../../domain/schemas/api.schema";
import type { Logger } from "../../shared/logger";
import { createErrorHandler, notFoundHandler } from "./middleware/error-handler.middleware";

export type AppOptions = {
  corsOrigin: string;
  version: string;
  llmConfigured: boolean;
  logger: Logger;
  // Mounted at /api. Built in composition/ and passed in, so createApp itself still constructs nothing.
  // Optional: /health must answer even on a process with no API wiring at all.
  api?: Router;
};

// Exported separately from listen() so tests can start it on an ephemeral port.
export function createApp({ corsOrigin, version, llmConfigured, logger, api }: AppOptions): Express {
  const app = express();
  app.disable("x-powered-by");

  // A function origin sends the CORS header only to the allowed origin; a plain string would send it to everyone.
  app.use(cors({ origin: (origin, callback) => callback(null, origin === corsOrigin) }));
  app.use(express.json({ limit: "10kb" }));

  app.get("/health", (_req, res) => {
    const body: HealthResponse = { status: "ok", service: "polaris-service", version, llmConfigured };
    res.json(body);
  });

  if (api !== undefined) app.use("/api", api);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}

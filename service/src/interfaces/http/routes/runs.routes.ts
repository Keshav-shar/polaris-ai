import { Router } from "express";
import type { ListRuns } from "../../../application/use-cases/list-runs.use-case";
import { RunsQuery } from "../../../domain/schemas/api.schema";
import { validateQuery } from "../middleware/validate.middleware";

// Accessor, not the use-case itself: the stack is built on first use, so an unconfigured LLM answers 503
// per request rather than killing the process (docs/conflicts.md C64).
export type RunsRoutesDeps = {
  listRuns(): ListRuns;
};

// Mounted at /api/runs. The UI's Codex reads this to learn which runs exist before fetching their trees.
export function createRunsRouter({ listRuns }: RunsRoutesDeps): Router {
  const query = validateQuery(RunsQuery);
  const router = Router();

  router.get("/", query.middleware, async (_req, res) => {
    res.json(await listRuns().execute(query.read(res).limit));
  });

  return router;
}

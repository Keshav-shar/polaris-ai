import { Router } from "express";
import type { ListRuns } from "../../../application/use-cases/list-runs.use-case";
import { RunsQuery } from "../../../domain/schemas/api.schema";
import { readCaller } from "../middleware/auth.middleware";
import { validateQuery } from "../middleware/validate.middleware";

// Accessor, not the use-case itself: the stack is built on first use, so an unconfigured LLM answers 503
// per request rather than killing the process (docs/conflicts.md C64).
export type RunsRoutesDeps = {
  listRuns(): ListRuns;
};

// Mounted at /api/runs. The library reads this to learn which runs exist before fetching their trees.
// Auth: `scope=mine` needs a signed-in user when auth is on (401 otherwise); `scope=public` needs none.
// Bounded by RUNS_LIST_LIMIT.
export function createRunsRouter({ listRuns }: RunsRoutesDeps): Router {
  const query = validateQuery(RunsQuery);
  const router = Router();

  router.get("/", query.middleware, async (_req, res) => {
    const { limit, scope } = query.read(res);
    res.json(await listRuns().execute(limit, { scope, caller: readCaller(res) }));
  });

  return router;
}

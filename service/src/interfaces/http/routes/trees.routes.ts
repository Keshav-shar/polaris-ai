import { Router } from "express";
import type { GetTree } from "../../../application/use-cases/get-tree.use-case";
import type { SetRunVisibility } from "../../../application/use-cases/set-run-visibility.use-case";
import type { StartTreeBuild } from "../../../application/use-cases/start-tree-build.use-case";
import { RunIdParams, TreeRequestBody, VisibilityBody } from "../../../domain/schemas/api.schema";
import { readCaller } from "../middleware/auth.middleware";
import { validateBody, validateParams } from "../middleware/validate.middleware";

// Accessors, not the use-cases themselves: composition builds the stack on first use, so an unconfigured
// LLM throws EnvError per request (503) instead of killing a server whose job is to answer that 503.
// Calling startTreeBuild() also ensures the local worker is draining (composition/container.ts).
export type TreesRoutesDeps = {
  startTreeBuild(): StartTreeBuild;
  getTree(): GetTree;
  setRunVisibility(): SetRunVisibility;
};

// Mounted at /api/trees. Handlers stay thin: validate, call one use-case, map the result. Express 5
// forwards a rejected handler promise to the error middleware, so failures need no try/catch here.
// The caller comes from auth.middleware, mounted on /api before every router (C105).
export function createTreesRouter({ startTreeBuild, getTree, setRunVisibility }: TreesRoutesDeps): Router {
  const body = validateBody(TreeRequestBody);
  const visibility = validateBody(VisibilityBody);
  const params = validateParams(RunIdParams);
  const router = Router();

  // 202, never 201: the tree does not exist yet. The build runs on the queue, and the caller polls GET.
  // Auth: signed-in when auth is on (401 otherwise). Limits: MAX_CONCURRENT_RUNS, MAX_RUNS_PER_USER_PER_DAY,
  // MAX_STORED_RUNS_PER_USER (pruning); per-IP bucket in Phase 11S.
  router.post("/", body.middleware, async (_req, res) => {
    const { prompt, maxDepth } = body.read(res);
    const caller = readCaller(res);
    const options = {
      ...(maxDepth === undefined ? {} : { maxDepth }),
      ...(caller === undefined ? {} : { caller }),
    };
    const result = await startTreeBuild().execute(prompt, Object.keys(options).length === 0 ? undefined : options);
    res.status(202).json(result);
  });

  // Auth: none for a non-private run; the owner for a private one (404 to anyone else).
  router.get("/:runId", params.middleware, async (_req, res) => {
    res.json(await getTree().execute(params.read(res).runId, readCaller(res)));
  });

  // Auth: the owner only (401 signed out, 404 for anyone else). One row updated, no LLM call.
  router.patch("/:runId", params.middleware, visibility.middleware, async (_req, res) => {
    res.json(
      await setRunVisibility().execute(params.read(res).runId, visibility.read(res).visibility, readCaller(res)),
    );
  });

  return router;
}

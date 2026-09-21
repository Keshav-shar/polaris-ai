import { Router } from "express";
import type { GetTree } from "../../../application/use-cases/get-tree.use-case";
import type { StartTreeBuild } from "../../../application/use-cases/start-tree-build.use-case";
import { RunIdParams, TreeRequestBody } from "../../../domain/schemas/api.schema";
import { validateBody, validateParams } from "../middleware/validate.middleware";

// Accessors, not the use-cases themselves: composition builds the stack on first use, so an unconfigured
// LLM throws EnvError per request (503) instead of killing a server whose job is to answer that 503.
// Calling startTreeBuild() also ensures the local worker is draining (composition/container.ts).
export type TreesRoutesDeps = {
  startTreeBuild(): StartTreeBuild;
  getTree(): GetTree;
};

// Mounted at /api/trees. Handlers stay thin: validate, call one use-case, map the result. Express 5
// forwards a rejected handler promise to the error middleware, so failures need no try/catch here.
export function createTreesRouter({ startTreeBuild, getTree }: TreesRoutesDeps): Router {
  const body = validateBody(TreeRequestBody);
  const params = validateParams(RunIdParams);
  const router = Router();

  // 202, never 201: the tree does not exist yet. The build runs on the queue, and the caller polls GET.
  router.post("/", body.middleware, async (_req, res) => {
    const { prompt, maxDepth } = body.read(res);
    const result = await startTreeBuild().execute(prompt, maxDepth === undefined ? undefined : { maxDepth });
    res.status(202).json(result);
  });

  router.get("/:runId", params.middleware, async (_req, res) => {
    res.json(await getTree().execute(params.read(res).runId));
  });

  return router;
}

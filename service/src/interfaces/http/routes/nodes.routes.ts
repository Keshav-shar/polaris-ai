import { Router } from "express";
import type { GetNode } from "../../../application/use-cases/get-node.use-case";
import { NodeIdParams } from "../../../domain/schemas/api.schema";
import { validateParams } from "../middleware/validate.middleware";

export type NodesRoutesDeps = {
  getNode(): GetNode;
};

// Mounted at /api/nodes. One call gives the reader the node, its article and its questions.
export function createNodesRouter({ getNode }: NodesRoutesDeps): Router {
  const params = validateParams(NodeIdParams);
  const router = Router();

  router.get("/:nodeId", params.middleware, async (_req, res) => {
    res.json(await getNode().execute(params.read(res).nodeId));
  });

  return router;
}

import { Router } from "express";
import type { BoostArticle } from "../../../application/use-cases/boost-article.use-case";
import type { GetNode } from "../../../application/use-cases/get-node.use-case";
import { NodeIdParams } from "../../../domain/schemas/api.schema";
import { validateParams } from "../middleware/validate.middleware";

export type NodesRoutesDeps = {
  getNode(): GetNode;
  boostArticle(): BoostArticle;
};

// Mounted at /api/nodes. One call gives the reader the node, its article and its questions.
export function createNodesRouter({ getNode, boostArticle }: NodesRoutesDeps): Router {
  const params = validateParams(NodeIdParams);
  const router = Router();

  router.get("/:nodeId", params.middleware, async (_req, res) => {
    res.json(await getNode().execute(params.read(res).nodeId));
  });

  // 202: the scroll is not written by this request, only moved up the queue. No body, no LLM call (C128).
  // Auth: none until Phase 12 (owner/visibility then); rate limit: the Phase 11S per-IP bucket. Cost if
  // abused: reordering only - at most one queued message moved per call, never a new one.
  router.post("/:nodeId/boost", params.middleware, async (_req, res) => {
    res.status(202).json(await boostArticle().execute(params.read(res).nodeId));
  });

  return router;
}

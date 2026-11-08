import { UnauthenticatedError } from "../../domain/errors/unauthenticated.error";
import type { Caller } from "../../domain/schemas/caller.schema";
import type { NodeProgress } from "../../domain/schemas/progress.schema";
import type { ProgressPort } from "../ports/progress.port";
import type { RunRepositoryPort } from "../ports/run-repository.port";
import type { TreeRepositoryPort } from "../ports/tree-repository.port";
import { readableNode } from "../tree/readable-node";

export type RecordProgress = {
  // Marks the lesson read for the caller and returns their progress on it. Sign-in required.
  markRead(nodeId: string, caller: Caller | undefined): Promise<NodeProgress>;
};

// PUT /api/nodes/:nodeId/progress (C106). A learner reading someone else's PUBLIC map records progress for
// themselves, never for the map's owner.
export function createRecordProgress(deps: {
  treeRepo: TreeRepositoryPort;
  runRepo: RunRepositoryPort;
  progress: ProgressPort;
}): RecordProgress {
  return {
    async markRead(nodeId, caller) {
      if (caller === undefined) throw new UnauthenticatedError("Sign in to keep track of what you have read.");
      const { node } = await readableNode(deps, nodeId, caller);
      await deps.progress.markRead({ userId: caller.userId, nodeId, runId: node.runId });
      return (await deps.progress.get(caller.userId, nodeId)) ?? { read: true, quizAttempts: 0 };
    },
  };
}

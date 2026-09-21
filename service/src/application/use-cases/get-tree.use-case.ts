import type { TreeResponse } from "../../domain/schemas/api.schema";
import { RunNotFoundError } from "../../domain/errors/run-not-found.error";
import type { TreeNode } from "../../domain/schemas/node.schema";
import type { RunRepositoryPort } from "../ports/run-repository.port";
import type { RunStatePort } from "../ports/run-state.port";
import type { TreeRepositoryPort } from "../ports/tree-repository.port";

export type GetTreeDeps = {
  runRepo: RunRepositoryPort;
  treeRepo: TreeRepositoryPort;
  runState: RunStatePort;
};

export type GetTree = {
  execute(runId: string): Promise<TreeResponse>;
};

// A halted run will not resume in this process, so its unfinished nodes are not "pending" in any useful
// sense - they are blocked on the condition that stopped the run. Derived here rather than stored: the
// node rows keep their four honest states and only the read model makes the distinction (C54).
function markBlocked(node: TreeNode): TreeNode {
  const blocked = node.status === "pending" || node.status === "expanded";
  return {
    ...node,
    status: blocked ? "blocked" : node.status,
    children: node.children.map(markBlocked),
  };
}

// Read model for GET /api/trees/:runId. The UI polls this while a run is constructing, so it must answer
// from stored state only - it never waits on the build.
export function createGetTree({ runRepo, treeRepo, runState }: GetTreeDeps): GetTree {
  return {
    async execute(runId) {
      const run = await runRepo.get(runId);
      if (run === undefined) throw new RunNotFoundError(runId);

      const [stored, state] = await Promise.all([treeRepo.getTree(runId), runState.get(runId)]);
      const tree = stored !== null && run.status === "halted" ? markBlocked(stored) : stored;
      return {
        run: {
          runId: run.runId,
          topic: run.topic,
          maxDepth: run.maxDepth,
          status: run.status,
          ...(run.haltReason === undefined ? {} : { haltReason: run.haltReason }),
        },
        tree,
        stats: {
          // No counters yet simply means nothing has completed - not an error.
          nodesDone: state?.nodesDone ?? 0,
          nodesFailed: state?.nodesFailed ?? 0,
          nodesSkipped: state?.nodesSkipped ?? 0,
          articlesDone: state?.articlesDone ?? 0,
          articlesFailed: state?.articlesFailed ?? 0,
        },
      };
    },
  };
}

import type { NodeStatePort, TerminalStatus } from "../ports/node-state.port";
import type { RunRepositoryPort } from "../ports/run-repository.port";
import type { RunStatePort } from "../ports/run-state.port";
import type { TreeRepositoryPort } from "../ports/tree-repository.port";

export type FanInDeps = {
  nodeState: NodeStatePort;
  treeRepo: TreeRepositoryPort;
  runState: RunStatePort;
  runRepo: RunRepositoryPort;
};

export type FanIn = {
  completeConstruction(nodeId: string, outcome: TerminalStatus): Promise<void>;
};

// Completing a node records it against its parent; when the parent's children are all accounted for it
// completes too, and the check repeats upward - several levels in one call. Iterative, never recursive:
// the walk is bounded by maxDepth but a deep tree should not grow the stack.
export function createFanIn({ nodeState, treeRepo, runState, runRepo }: FanInDeps): FanIn {
  return {
    async completeConstruction(nodeId, outcome) {
      let current = nodeId;
      let status: TerminalStatus = outcome;

      for (;;) {
        // Conditional: undefined means the node was already terminal. This is what makes a node complete
        // its parent EXACTLY once even when two last-children finish concurrently.
        const finished = await nodeState.finish(current, status);
        if (finished === undefined) return;

        await treeRepo.setStatus(finished.nodeId, status);
        await runState.countNode(finished.runId, status);

        if (finished.parentId === null) {
          // The root is terminal, so the whole run is. A failed root means no tree was built: reporting
          // it as `constructed` would tell the UI to poll for a tree that will never arrive. The
          // pseudocode in docs/aws-retrofit.md only covers the success case (docs/conflicts.md C52).
          // Phase 10 also sends the root article message here on success, which is why the article queue
          // is not a dependency of this module yet.
          await runRepo.setStatus(finished.runId, status === "failed" ? "failed" : "constructed");
          return;
        }

        // Rule 5: undefined for a duplicate completion, so a redelivered child cannot double-count.
        const parent = await nodeState.recordChildCompletion(finished.parentId, current, status);
        if (parent === undefined) return;
        // `expanded` guards two cases: a parent still mid-expansion (expectedChildren not yet written), and
        // a parent already failed by the dead-letter path, which its children must not resurrect.
        if (parent.status !== "expanded") return;
        if (parent.expectedChildren === undefined || parent.completedChildren < parent.expectedChildren) return;

        // A failed child still counts towards its parent, so a failed branch never blocks its ancestors -
        // the parent completes `done` once every child is accounted for, however each one ended.
        current = parent.nodeId;
        status = "done";
      }
    },
  };
}

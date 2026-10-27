import type { RunState } from "../../domain/schemas/node-state.schema";
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
  // Counts one finished article and, when every article is in, moves the run to `done`. Resolves TRUE
  // only when THIS call owned the terminal transition, so a caller with a side effect to run once per
  // article can tell a real completion from a redelivery that `finishArticle` already absorbed.
  completeArticle(runId: string, nodeId: string, outcome: TerminalStatus, reason?: string): Promise<boolean>;
};

// Completing a node records it against its parent; when the parent's children are all accounted for it
// completes too, and the check repeats upward - several levels in one call. Iterative, never recursive:
// the walk is bounded by maxDepth but a deep tree should not grow the stack.
//
// This module no longer hands the article pass its trigger: since C91 an expanded node enqueues its OWN
// article (expand-node.use-case.ts), so the two passes overlap in time and the fan-in is pure accounting -
// no LLM call and no re-work happens on this walk.
export function createFanIn({ nodeState, treeRepo, runState, runRepo }: FanInDeps): FanIn {
  // The run is done when construction has finished AND every constructed node's article is accounted for.
  // BOTH halves matter now that the passes overlap: articles start landing while `nodesDone` is still
  // climbing, so the count alone would declare a run finished after its first leaf.
  const finishRunIfComplete = async (runId: string, counted: RunState): Promise<void> => {
    const run = await runRepo.get(runId);
    // `constructed` and nothing else: `constructing` means more nodes are coming, `done`/`failed`/`halted`
    // are terminal and must not be rewritten.
    if (run?.status !== "constructed") return;
    // Only nodes whose CONSTRUCTION succeeded get an article ("failed construction nodes get no
    // article", docs/aws-retrofit.md), and nodesDone counts exactly those - so that is the target.
    const written = counted.articlesDone + counted.articlesFailed;
    if (written >= counted.nodesDone) await runRepo.setStatus(runId, "done");
  };

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
        const counted = await runState.countNode(finished.runId, status);

        if (finished.parentId === null) {
          // Only a run still `constructing` moves on. Another path may already have ended it - the ARTICLE
          // worker halts the run when the writer pool's day is gone while construction still has quota -
          // and overwriting that `halted` with `constructed` leaves a run that can never reach `done`, which
          // the UI then polls forever (found live 2026-10-07, C120). Phase 12 makes this one conditional
          // UPDATE (`where status = 'constructing'`).
          const current = await runRepo.get(finished.runId);
          if (current?.status !== "constructing") return;
          // The root is terminal, so construction is. A failed root means no tree was built: reporting
          // it as `constructed` would tell the UI to poll for a tree that will never arrive. The
          // pseudocode in docs/aws-retrofit.md only covers the success case (docs/conflicts.md C52).
          await runRepo.setStatus(finished.runId, status === "failed" ? "failed" : "constructed");
          // The articles have been in flight all along, so they may already all be in: this is the only
          // other moment the run can become `done`, and without it a fast tree would sit at `constructed`
          // with every scroll written.
          if (status !== "failed") await finishRunIfComplete(finished.runId, counted);
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

    async completeArticle(runId, nodeId, outcome, reason) {
      // Conditional, exactly like `finish`: undefined means this article was already counted, so a
      // redelivery cannot inflate articlesDone or declare the run done early.
      const finished = await nodeState.finishArticle(nodeId, outcome);
      if (finished === undefined) return false;

      // Recorded on the permanent row, so GET /api/trees can show which scrolls exist.
      await treeRepo.setArticleStatus(nodeId, outcome, reason);
      await finishRunIfComplete(runId, await runState.countArticle(runId, outcome));
      return true;
    },
  };
}

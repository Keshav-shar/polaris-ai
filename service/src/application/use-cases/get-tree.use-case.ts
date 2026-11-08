import type { TreeResponse } from "../../domain/schemas/api.schema";
import { canReadRun, isRunOwner } from "../../domain/entities/run-access";
import { statsFromTree } from "../../domain/entities/tree-stats";
import { RunNotFoundError } from "../../domain/errors/run-not-found.error";
import type { Caller } from "../../domain/schemas/caller.schema";
import type { TreeNode } from "../../domain/schemas/node.schema";
import type { RunRepositoryPort } from "../ports/run-repository.port";
import type { ProgressPort } from "../ports/progress.port";
import type { RunStatePort } from "../ports/run-state.port";
import type { TreeRepositoryPort } from "../ports/tree-repository.port";
import type { Logger } from "../../shared/logger";
import { optionalRead } from "../tree/optional-read";

export type GetTreeDeps = {
  runRepo: RunRepositoryPort;
  treeRepo: TreeRepositoryPort;
  // Absent where the in-flight counters are not reachable: Express under QUEUE_MODE=sqs, where they live in
  // DynamoDB. The counts are then taken from the tree rows (A19, C141).
  runState?: RunStatePort | undefined;
  // The signed-in reader's read/quiz markers (Phase C). Optional so the read path works without per-user stores.
  progress?: ProgressPort | undefined;
  // Where a failed progress read is reported; the tree is served without the markers either way (C143).
  logger?: Pick<Logger, "warn"> | undefined;
};

export type GetTree = {
  // `caller` absent = an anonymous reader. A private run that is not theirs answers 404 (C105).
  execute(runId: string, caller?: Caller): Promise<TreeResponse>;
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
export function createGetTree({ runRepo, treeRepo, runState, progress, logger }: GetTreeDeps): GetTree {
  return {
    async execute(runId, caller) {
      const run = await runRepo.get(runId);
      if (run === undefined || !canReadRun(run, caller)) throw new RunNotFoundError(runId);

      const [stored, state, mine] = await Promise.all([
        treeRepo.getTree(runId),
        runState?.get(runId),
        // The reader's own markers: optional, so a failed read costs the markers, never the tree (C143).
        caller === undefined
          ? undefined
          : optionalRead(progress?.listForRun(caller.userId, runId), logger, "progress.listForRun"),
      ]);
      const tree = stored !== null && run.status === "halted" ? markBlocked(stored) : stored;
      return {
        run: {
          runId: run.runId,
          topic: run.topic,
          maxDepth: run.maxDepth,
          status: run.status,
          ...(run.haltReason === undefined ? {} : { haltReason: run.haltReason }),
          ...(run.ownerId === undefined
            ? {}
            : { visibility: run.visibility ?? "private", isOwner: isRunOwner(run, caller) }),
        },
        tree,
        // The live counters while they exist; once they have expired (or the process restarted) the copy taken
        // at the last terminal transition (C107). Neither simply means nothing has completed - not an error.
        // Without a run-state store at all, a finished run's copy, else a live count from the rows (A19).
        stats:
          runState === undefined
            ? (run.stats ?? statsFromTree(stored, 0))
            : {
                nodesDone: state?.nodesDone ?? run.stats?.nodesDone ?? 0,
                nodesFailed: state?.nodesFailed ?? run.stats?.nodesFailed ?? 0,
                nodesSkipped: state?.nodesSkipped ?? run.stats?.nodesSkipped ?? 0,
                articlesDone: state?.articlesDone ?? run.stats?.articlesDone ?? 0,
                articlesFailed: state?.articlesFailed ?? run.stats?.articlesFailed ?? 0,
              },
        ...(mine === undefined ? {} : { progress: mine }),
      };
    },
  };
}

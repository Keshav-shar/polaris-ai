import { canReadRun } from "../../domain/entities/run-access";
import { NodeNotFoundError } from "../../domain/errors/node-not-found.error";
import type { Caller } from "../../domain/schemas/caller.schema";
import type { Run } from "../../domain/schemas/run.schema";
import type { RunRepositoryPort } from "../ports/run-repository.port";
import type { StoredNode, TreeRepositoryPort } from "../ports/tree-repository.port";

// The node and its run, or NodeNotFoundError - for an unknown node AND for a node of a private run that is not the
// caller's, so ids cannot be probed (C105). Every node-scoped use-case goes through this one rule.
export async function readableNode(
  deps: { treeRepo: TreeRepositoryPort; runRepo: RunRepositoryPort },
  nodeId: string,
  caller: Caller | undefined,
): Promise<{ node: StoredNode; run: Run }> {
  const node = await deps.treeRepo.getNode(nodeId);
  if (node === undefined) throw new NodeNotFoundError(nodeId);
  const run = await deps.runRepo.get(node.runId);
  if (run === undefined || !canReadRun(run, caller)) throw new NodeNotFoundError(nodeId);
  return { node, run };
}

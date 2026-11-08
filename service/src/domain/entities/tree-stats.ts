import type { TreeNode } from "../schemas/node.schema";
import type { RunStats } from "../schemas/run.schema";

// The run's counters, counted from the stored tree rows (A19, C141). The read path uses this when no in-flight run
// state is reachable - Express under QUEUE_MODE=sqs, where those counters live in DynamoDB. `nodesSkipped` is not
// visible in the rows, so it comes from the durable copy (0 until the run's terminal transition).
export function statsFromTree(tree: TreeNode | null, nodesSkipped: number): RunStats {
  const stats: RunStats = { nodesDone: 0, nodesFailed: 0, nodesSkipped, articlesDone: 0, articlesFailed: 0 };
  const stack = tree === null ? [] : [tree];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node.status === "done") stats.nodesDone += 1;
    if (node.status === "failed") stats.nodesFailed += 1;
    if (node.articleStatus === "done") stats.articlesDone += 1;
    if (node.articleStatus === "failed") stats.articlesFailed += 1;
    stack.push(...node.children);
  }
  return stats;
}

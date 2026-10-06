import "dotenv/config";
import { createBuildStack } from "../src/composition/build-stack";
import { getEnv, isLlmConfigured, requireLlmEnv } from "../src/config/env";
import type { TreeNode } from "../src/domain/schemas/node.schema";
import { estimateExpandCalls } from "../src/domain/traversal/estimate-expand-calls";
import { createLogger } from "../src/shared/logger";
import { failureDetail } from "./redact";

// Real end-to-end BUILD on the local queue - both passes, because since C91 they run at the same time:
// each expanded node hands itself straight to the article queue. Cost is roughly `branching ^ maxDepth`
// expand calls plus one search and one writer call per node, so
// the default is 1 (~6 nodes). Pass a larger depth only when the quota allows -
// the pipeline itself is depth-agnostic and is proven at depth by the unit tests. A run that outlives its
// quota is NOT an error here: it prints the tree it managed to build, with `[blocked]` on the rest.
function render(node: TreeNode, indent = ""): string {
  const head = `${indent}${node.depth === 0 ? "" : "- "}${node.topic} [${node.status}]`;
  const brief = node.brief === "" ? "" : `\n${indent}  ${node.brief}`;
  return [head + brief, ...node.children.map((child) => render(child, `${indent}  `))].join("\n");
}

// "expanded" counts the nodes an LLM call was actually spent on, which is what a partial run wants to
// report. A node's status can be blocked while its brief is already written and paid for, so the brief -
// not the status - is the evidence that the work happened.
function countNodes(node: TreeNode): { known: number; expanded: number } {
  return node.children.reduce(
    (total, child) => {
      const sub = countNodes(child);
      return { known: total.known + sub.known, expanded: total.expanded + sub.expanded };
    },
    { known: 1, expanded: node.brief === "" ? 0 : 1 },
  );
}

async function main(): Promise<void> {
  const [prompt, maxDepthArg = "1"] = process.argv.slice(2);
  if (!prompt?.trim()) {
    console.error('Usage: npm run smoke:node -- "<prompt>" [maxDepth=1]');
    process.exit(1);
  }
  const maxDepth = Number(maxDepthArg);
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    console.error(`maxDepth must be an integer >= 1, got "${maxDepthArg}"`);
    process.exit(1);
  }

  const env = getEnv();
  if (!isLlmConfigured(env)) {
    console.error("LLM not configured (set LLM_BASE_URL, LLM_API_KEY, LLM_MODEL): smoke test not run.");
    process.exit(1);
  }
  const logger = createLogger({ level: env.LOG_LEVEL });
  let fatal: unknown;
  const stack = createBuildStack(env, logger, {
    onFatal: (error) => {
      fatal = error;
    },
  });

  // The parser infers a depth from the prompt; the smoke run overrides it so cost stays predictable.
  const { runId } = await stack.startTreeBuild.execute(prompt, { maxDepth });
  const started = Date.now();
  stack.worker.start();
  // Started together, not one after the other: article messages arrive while the tree is still growing.
  stack.articleWorker.start();
  // Awaiting one then the other is not enough - construction can enqueue an article after the article
  // worker has already gone idle. Both idle at the same instant IS the fixpoint: only a running handler
  // can enqueue anything, and there is none.
  for (;;) {
    await stack.worker.idle();
    await stack.articleWorker.idle();
    if (stack.worker.isIdle() && stack.articleWorker.isIdle()) break;
  }
  await stack.worker.stop();
  await stack.articleWorker.stop();

  const { run, tree, stats } = await stack.getTree.execute(runId);
  const estimate = estimateExpandCalls(maxDepth);
  const configured = requireLlmEnv(env);
  const answered = stack.activeModel();
  // The configured lead is not always the one that answered - a rotation inside the model pool changes
  // it - so name the model that actually did.
  const pool = configured.models.length > 1 ? ` pool=${configured.models.length} (${configured.rotation})` : "";
  const modelLine =
    answered === configured.model
      ? `model=${configured.model}${pool}`
      : `lead=${configured.model}${pool} -> answered by ${answered}`;
  console.log(`\n${modelLine}`);

  if (tree === null) {
    console.log(`run ${runId} → ${run.status} (maxDepth ${maxDepth}, ${Date.now() - started} ms)`);
    console.log("(no tree: the root was never claimed)");
  } else {
    const { known, expanded } = countNodes(tree);
    const progress =
      expanded === known
        ? `${known} nodes, ${stats.articlesDone} scrolls`
        : `INCOMPLETE: ${expanded} of ${known} known nodes expanded; est. ~${estimate} for a full tree`;
    console.log(`run ${runId} → ${run.status} (maxDepth ${maxDepth}, ${progress}, ${Date.now() - started} ms)`);
    if (run.haltReason !== undefined) console.log(`reason: ${run.haltReason}`);
    if (stats.nodesSkipped > 0) {
      // The tree below is complete as built, but shallower than maxDepth implies. Saying so beats
      // letting it look like the model simply had nothing more to say.
      console.log(`capped: MAX_NODES_PER_RUN reached; ${stats.nodesSkipped} further topics not expanded`);
    }
    console.log(`\n${render(tree)}`);
  }
  console.log(`\nstats ${JSON.stringify(stats)}`);

  // A halt is a stall, not a crash: the partial tree above is the result. Exit non-zero so CI still
  // notices, but never in place of the output.
  if (fatal !== undefined) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  // Never let a provider error echo the key back.
  console.error(failureDetail(getEnv(), error));
  process.exit(1);
});

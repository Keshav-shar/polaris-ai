import "dotenv/config";
import { createExpandAgent } from "../src/application/agents/expand.agent";
import { verifyExpansion } from "../src/application/agents/verifier.agent";
import { createStructuredGenerator } from "../src/application/llm/structured";
import { createNodeConstructor } from "../src/application/tree/construct-node";
import { createLlmFromEnv } from "../src/composition/llm";
import { failureDetail } from "./redact";
import { getEnv, requireLlmEnv } from "../src/config/env";
import { NodeContext } from "../src/domain/schemas/node.schema";
import { layerPosition } from "../src/domain/traversal/layer-position";
import { normalizeTopic } from "../src/domain/traversal/node-id";
import { createLogger } from "../src/shared/logger";

// Runs the same node N times and reports how much the children vary. Costs N LLM calls.
// Compare settings by running it again with a different LLM_TEMPERATURE / LLM_SEED_MODE.

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  return [...a].filter((x) => b.has(x)).length / union.size;
}


async function main(): Promise<void> {
  const [topic, runsArg = "3", depthArg = "0", maxDepthArg = "2"] = process.argv.slice(2);
  const runs = Number(runsArg);
  if (!topic?.trim() || !Number.isInteger(runs) || runs < 2 || runs > 10) {
    console.error('Usage: npm run consistency -- "<topic>" [runs=3, 2-10] [depth=0] [maxDepth=2]');
    process.exit(1);
  }
  const depth = Number(depthArg);
  const maxDepth = Number(maxDepthArg);
  const context = NodeContext.parse({ depth, maxDepth, position: layerPosition(depth, maxDepth), ancestors: [] });

  const env = getEnv();
  const generate = createStructuredGenerator(createLlmFromEnv(env).llm);
  const constructor = createNodeConstructor({
    expand: createExpandAgent({ generate }).expand,
    verify: verifyExpansion,
    logger: createLogger(),
  });

  // Sequential on purpose: parallel calls could hit the provider's per-minute limit.
  const results: string[][] = [];
  for (let i = 0; i < runs; i++) {
    const out = await constructor.construct({
      topic: topic.trim(),
      brief: `An overview of ${topic.trim()}.`,
      context,
      seedKey: `consistency:${topic.trim()}`,
    });
    results.push(out.children.map((child) => child.topic));
  }

  const sets = results.map((children) => new Set(children.map(normalizeTopic)));
  const pairs: number[] = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) pairs.push(jaccard(sets[i]!, sets[j]!));
  }
  const inAll = [...sets[0]!].filter((t) => sets.every((s) => s.has(t)));
  const counts = results.map((r) => r.length);

  console.log(
    JSON.stringify(
      {
        settings: { model: env.LLM_MODEL, temperature: env.LLM_TEMPERATURE ?? "provider default", seedMode: env.LLM_SEED_MODE },
        position: context.position,
        runs,
        childCounts: counts,
        countRange: [Math.min(...counts), Math.max(...counts)],
        meanPairwiseJaccard: Number((pairs.reduce((a, b) => a + b, 0) / pairs.length).toFixed(2)),
        inEveryRun: inAll,
        onlyInSomeRuns: results.map((r) => r.filter((c) => !inAll.includes(normalizeTopic(c)))),
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(`FAIL: ${failureDetail(getEnv(), error)}`);
  process.exit(1);
});

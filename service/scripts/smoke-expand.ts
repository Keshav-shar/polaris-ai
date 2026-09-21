import "dotenv/config";
import { createConsolidatorAgent } from "../src/application/agents/consolidator.agent";
import { createExpandAgent } from "../src/application/agents/expand.agent";
import { verifyExpansion } from "../src/application/agents/verifier.agent";
import { createStructuredGenerator } from "../src/application/llm/structured";
import { createNodeConstructor } from "../src/application/tree/construct-node";
import { createLlmFromEnv } from "../src/composition/llm";
import { failureDetail } from "./redact";
import { getEnv, requireLlmEnv } from "../src/config/env";
import { NodeContext } from "../src/domain/schemas/node.schema";
import { layerPosition } from "../src/domain/traversal/layer-position";
import { createLogger } from "../src/shared/logger";


async function main(): Promise<void> {
  const [topic, depthArg = "0", maxDepthArg = "2"] = process.argv.slice(2);
  if (!topic?.trim()) {
    console.error('Usage: npm run smoke:expand -- "<topic>" [depth=0] [maxDepth=2]');
    process.exit(1);
  }
  const depth = Number(depthArg);
  const maxDepth = Number(maxDepthArg);
  // No ancestors: the smoke run expands one node in isolation.
  const context = NodeContext.parse({ depth, maxDepth, position: layerPosition(depth, maxDepth), ancestors: [] });

  const env = getEnv();
  const generate = createStructuredGenerator(createLlmFromEnv(env).llm);
  const constructor = createNodeConstructor({
    expand: createExpandAgent({ generate }).expand,
    verify: verifyExpansion,
    consolidate: createConsolidatorAgent({ generate }).consolidate,
    logger: createLogger(),
  });

  const output = await constructor.construct({ topic: topic.trim(), context });
  console.log(JSON.stringify({ position: context.position, childCount: output.children.length, ...output }, null, 2));
}

main().catch((error: unknown) => {
  console.error(`FAIL: ${failureDetail(getEnv(), error)}`);
  process.exit(1);
});

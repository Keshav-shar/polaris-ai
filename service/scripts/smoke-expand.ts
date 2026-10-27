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
import { createLogger } from "../src/shared/logger";


async function main(): Promise<void> {
  const [topic, depthArg = "0", maxDepthArg = "2"] = process.argv.slice(2);
  if (!topic?.trim()) {
    console.error('Usage: npm run smoke:expand -- "<topic>" [depth=0] [maxDepth=2]');
    process.exit(1);
  }
  const depth = Number(depthArg);
  const maxDepth = Number(maxDepthArg);
  if (depth >= maxDepth) {
    console.error("depth must be below maxDepth: the final layer is written by its parent and never called (C99)");
    process.exit(1);
  }
  // No ancestors: the smoke run expands one node in isolation.
  const context = NodeContext.parse({ depth, maxDepth, position: layerPosition(depth, maxDepth), ancestors: [] });

  const env = getEnv();
  const generate = createStructuredGenerator(createLlmFromEnv(env).llm);
  const constructor = createNodeConstructor({
    expand: createExpandAgent({ generate }).expand,
    verify: verifyExpansion,
    logger: createLogger(),
  });

  // Depth 0 exercises the ROOT call, which reads the text as a learner's request and names the topic (C100);
  // any other depth is an interior call, given a placeholder for the brief its parent would have written.
  const output = await constructor.construct(
    depth === 0
      ? { topic: topic.trim(), request: topic.trim(), context }
      : { topic: topic.trim(), brief: `An overview of ${topic.trim()}.`, context },
  );
  console.log(JSON.stringify({ position: context.position, childCount: output.children.length, ...output }, null, 2));
}

main().catch((error: unknown) => {
  console.error(`FAIL: ${failureDetail(getEnv(), error)}`);
  process.exit(1);
});

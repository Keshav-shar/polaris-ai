import "dotenv/config";
import { createParserAgent } from "../src/application/agents/parser.agent";
import { createStructuredGenerator } from "../src/application/llm/structured";
import { createLlmFromEnv } from "../src/composition/llm";
import { failureDetail } from "./redact";
import { getEnv, requireLlmEnv } from "../src/config/env";
import { createLogger } from "../src/shared/logger";


async function main(): Promise<void> {
  const prompt = process.argv.slice(2).join(" ").trim();
  if (!prompt) {
    console.error('Usage: npm run smoke:parser -- "<prompt>"');
    process.exit(1);
  }
  const env = getEnv();
  const parser = createParserAgent({
    generate: createStructuredGenerator(createLlmFromEnv(env).llm),
    logger: createLogger(),
  });
  console.log(JSON.stringify(await parser.parse(prompt)));
}

main().catch((error: unknown) => {
  console.error(`FAIL: ${failureDetail(getEnv(), error)}`);
  process.exit(1);
});

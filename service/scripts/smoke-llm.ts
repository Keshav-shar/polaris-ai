import "dotenv/config";
import { z } from "zod";
import { createStructuredGenerator } from "../src/application/llm/structured";
import { createLlmFromEnv } from "../src/composition/llm";
import { failureDetail } from "./redact";
import { getEnv, requireLlmEnv } from "../src/config/env";

// Smoke-only shape; not a domain contract.
const SmokeOutput = z.object({ ok: z.literal(true) });


async function main(): Promise<void> {
  const env = getEnv();
  const generate = createStructuredGenerator(createLlmFromEnv(env).llm);
  const result = await generate({
    schema: SmokeOutput,
    system: "You reply with JSON only.",
    user: 'Reply with exactly this JSON object: {"ok": true}',
    label: "smoke-llm",
  });
  console.log(JSON.stringify(result));
}

main().catch((error: unknown) => {
  console.error(`FAIL: ${failureDetail(getEnv(), error)}`);
  process.exit(1);
});

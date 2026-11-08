import "dotenv/config";
import { createGuardrailAgent } from "../src/application/agents/guardrail.agent";
import { createRetrievalAgent } from "../src/application/agents/retrieval.agent";
import { createSearchFromEnv } from "../src/composition/search";
import { getEnv } from "../src/config/env";
import { CREDIBILITY } from "../src/config/constants";
import { sourceKind } from "../src/domain/schemas/evidence.schema";
import { createLogger } from "../src/shared/logger";
import { failureDetail } from "./redact";

// One real retrieval for one node across every provider in SEARCH_PROVIDERS (C146): parallel search -> merge ->
// dedupe -> pure credibility scores -> the gate's verdict. Costs NO LLM call. A provider that fails or is skipped
// is logged as a warning and the rest still answer.
async function main(): Promise<void> {
  const [topic, parentTopic] = process.argv.slice(2);
  if (!topic?.trim()) {
    console.error('Usage: npm run smoke:evidence -- "<topic>" ["<parent topic>"]');
    process.exit(1);
  }

  const env = getEnv();
  const retrieval = createRetrievalAgent({ search: createSearchFromEnv(env, createLogger()) });
  const guardrail = createGuardrailAgent();

  const parent = parentTopic?.trim() ? parentTopic.trim() : null;
  const started = Date.now();
  const { query, retrievedAt, items } = await retrieval.retrieve({ topic: topic.trim(), parentTopic: parent });
  const assessment = guardrail.assessCredibility(items);

  console.log(
    `\nproviders=${env.SEARCH_PROVIDERS.join(",")} query="${query}" at=${retrievedAt} (${Date.now() - started} ms)\n`,
  );
  const perProvider = new Map<string, number>();
  for (const item of items) {
    const provider = item.provider ?? "unknown";
    perProvider.set(provider, (perProvider.get(provider) ?? 0) + 1);
    const mark = item.credibility >= CREDIBILITY.MIN_SCORE ? "+" : "-";
    console.log(`${mark} ${item.credibility.toFixed(2)}  [${provider}/${sourceKind(item.provider)}] ${item.title}\n    ${item.url}`);
  }
  console.log(`\nper provider ${JSON.stringify(Object.fromEntries(perProvider))}`);
  console.log(
    `verdict ${JSON.stringify({
      verified: assessment.verified,
      credibleCount: assessment.credibleCount,
      distinctDomains: assessment.distinctDomains,
    })}`,
  );
  // A node that fails the gate is NOT an error: it still gets an article, marked unverified. Exit 0
  // either way, and let the verdict line say which happened.
}

main().catch((error: unknown) => {
  console.error(`FAIL: ${failureDetail(getEnv(), error)}`);
  process.exit(1);
});

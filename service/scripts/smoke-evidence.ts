import "dotenv/config";
import { createGuardrailAgent } from "../src/application/agents/guardrail.agent";
import { createRetrievalAgent } from "../src/application/agents/retrieval.agent";
import { createSearchFromEnv } from "../src/composition/search";
import { getEnv } from "../src/config/env";
import { failureDetail } from "./redact";

// One real retrieval for one node: search -> dedupe -> pure credibility scores -> the gate's verdict.
// Costs NO LLM call. On the default provider (Wikipedia) it costs no quota either.
async function main(): Promise<void> {
  const [topic, parentTopic] = process.argv.slice(2);
  if (!topic?.trim()) {
    console.error('Usage: npm run smoke:evidence -- "<topic>" ["<parent topic>"]');
    process.exit(1);
  }

  const env = getEnv();
  const retrieval = createRetrievalAgent({ search: createSearchFromEnv(env) });
  const guardrail = createGuardrailAgent();

  const parent = parentTopic?.trim() ? parentTopic.trim() : null;
  const started = Date.now();
  const { query, retrievedAt, items } = await retrieval.retrieve({ topic: topic.trim(), parentTopic: parent });
  const assessment = guardrail.assessCredibility(items);

  console.log(
    `\nprovider=${env.SEARCH_PROVIDER} query="${query}" at=${retrievedAt} (${Date.now() - started} ms)\n`,
  );
  for (const item of items) {
    const mark = item.credibility >= 0.6 ? "+" : "-";
    console.log(`${mark} ${item.credibility.toFixed(2)}  ${item.title}\n    ${item.url}`);
  }
  console.log(
    `\nverdict ${JSON.stringify({
      verified: assessment.verified,
      credibleCount: assessment.credibleCount,
      distinctDomains: assessment.distinctDomains,
      groundedness: guardrail.checkGroundedness().status,
    })}`,
  );
  // A node that fails the gate is NOT an error: it still gets an article, marked unverified. Exit 0
  // either way, and let the verdict line say which happened.
}

main().catch((error: unknown) => {
  console.error(`FAIL: ${failureDetail(getEnv(), error)}`);
  process.exit(1);
});

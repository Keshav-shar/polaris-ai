import "dotenv/config";
import { createExpandAgent } from "../src/application/agents/expand.agent";
import { verifyExpansion } from "../src/application/agents/verifier.agent";
import { buildWriterUserPrompt, WRITER_SYSTEM_PROMPT } from "../src/application/agents/writer.prompt";
import { createStructuredGenerator } from "../src/application/llm/structured";
import { QUIZ_CONFIG } from "../src/config/constants";
import { type Env, getEnv, isLlmConfigured, requireLlmEnv } from "../src/config/env";
import { ArticleContext, WriterOutput } from "../src/domain/schemas/article.schema";
import type { NodeContext } from "../src/domain/schemas/node.schema";
import { articleBudget } from "../src/domain/traversal/article-budget";
import { createOpenAiCompatibleLlm } from "../src/infrastructure/llm/openai-compatible.adapter";
import { countWords } from "../src/shared/words";
import { failureDetail } from "./redact";

// Vets pool members on BOTH prompts before they go into the rotation. Phase 8.5 vetted them on the EXPAND
// prompt only, which is how a model whose per-minute OUTPUT cap is smaller than one article
// (`OTPM Limit 1000, Requested 2048`) stayed in the pool and killed scrolls it could never have written.
//
// Three calls per model: expand at an interior layer, expand at the leaf layer, and one writer call.
// Everything else is fixed - the evidence is a literal, so no search runs and a difference between two
// models is the model. Costs `3 x models` LLM requests and writes nothing.
//
// Usage: npm run model-eval [-- <model> ...]

const CANDIDATES = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-scout-17b-16e-instruct",
];

const TOPIC = "Virtual memory";
const PARENT = { topic: "Memory management", brief: "How an operating system hands out and reclaims memory." };
const CHILDREN = [{ topic: "Paging" }, { topic: "Page replacement" }, { topic: "Address translation" }];

// Two real sources, quoted rather than retrieved: the question is whether a model cites what it was
// GIVEN, and a live search would make that answer depend on the day's Wikipedia results.
const EVIDENCE = [
  {
    url: "https://en.wikipedia.org/w/index.php?curid=32354",
    title: "Virtual memory",
    snippet:
      "Virtual memory is a memory management technique that provides an idealized abstraction of the " +
      "storage resources that are actually available on a given machine, creating the illusion to users " +
      "of a very large main memory.",
    credibility: 0.9,
  },
  {
    url: "https://en.wikipedia.org/w/index.php?curid=23016",
    title: "Paging",
    snippet:
      "In computer operating systems, memory paging is a memory management scheme that eliminates the " +
      "need for contiguous allocation of physical memory, storing and retrieving data from secondary " +
      "storage in same-size blocks called pages.",
    credibility: 0.9,
  },
];

type Row = {
  model: string;
  expand: string;
  leaf: string;
  article: string;
  citations: string;
  questions: string;
  ms: number;
};

const ok = (pass: boolean, detail: string): string => `${pass ? "PASS" : "FAIL"} ${detail}`;

const ancestor = (depth: number) => ({ depth, topic: PARENT.topic, brief: PARENT.brief });

function contextAt(depth: number, maxDepth: number, position: NodeContext["position"]): NodeContext {
  return { depth, maxDepth, position, ancestors: [ancestor(depth - 1)] };
}

async function evaluate(model: string, env: Env): Promise<Row> {
  const profile = requireLlmEnv(env);
  // ONE member, its own limiter and its own retry budget: a pool would hide which model answered.
  const generate = createStructuredGenerator(
    createOpenAiCompatibleLlm({
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model,
      jsonMode: profile.jsonMode,
      maxConcurrency: 1,
      temperature: profile.temperature,
      seedMode: profile.seedMode,
    }),
  );
  const expand = createExpandAgent({ generate }).expand;
  const row: Row = { model, expand: "-", leaf: "-", article: "-", citations: "-", questions: "-", ms: 0 };
  const started = Date.now();

  try {
    const output = await expand({ topic: TOPIC, context: contextAt(1, 3, "normal") });
    const verified = verifyExpansion({
      output,
      topic: TOPIC,
      ancestors: [ancestor(0)],
      position: "normal",
    });
    row.expand = ok(verified.output.children.length > 0, `${verified.output.children.length} children`);
  } catch (error) {
    row.expand = `ERROR ${failureDetail(env, error)}`;
  }

  try {
    const output = await expand({ topic: TOPIC, context: contextAt(3, 3, "leaf") });
    // The verifier strips children at a leaf, so what this measures is whether the MODEL obeyed the rule.
    const verified = verifyExpansion({ output, topic: TOPIC, ancestors: [ancestor(2)], position: "leaf" });
    row.leaf = ok(verified.strippedLeafChildren === 0, `stripped ${verified.strippedLeafChildren}`);
  } catch (error) {
    row.leaf = `ERROR ${failureDetail(env, error)}`;
  }

  try {
    const context = ArticleContext.parse({
      node: { id: "00000000-0000-4000-8000-000000000001", topic: TOPIC, depth: 1, brief: PARENT.brief },
      parent: PARENT,
      isLeaf: false,
      children: CHILDREN,
      evidence: EVIDENCE,
    });
    const budget = articleBudget(CHILDREN.length);
    // generate() directly rather than the writer agent: the agent DROPS citations to urls it was not
    // given, and how many it would drop is exactly the measurement wanted here.
    const draft = await generate({
      schema: WriterOutput,
      system: WRITER_SYSTEM_PROMPT,
      user: buildWriterUserPrompt(context, budget),
      label: "writer",
      seed: undefined,
    });
    const words = countWords(draft.contentMd);
    row.article = ok(
      words >= budget.minWords && words <= budget.maxWords,
      `${words}w (band ${budget.minWords}-${budget.maxWords})`,
    );
    const allowed = new Set(EVIDENCE.map((item) => item.url));
    const invented =
      draft.citations.filter((citation) => !allowed.has(citation.url)).length +
      (draft.questions ?? []).filter((question) => !allowed.has(question.evidenceUrl)).length;
    row.citations = ok(invented === 0 && draft.citations.length > 0, `${draft.citations.length} cited, ${invented} invented`);
    row.questions = ok(
      draft.questions?.length === QUIZ_CONFIG.QUESTIONS_PER_TOPIC,
      `${draft.questions?.length ?? 0}/${QUIZ_CONFIG.QUESTIONS_PER_TOPIC}`,
    );
  } catch (error) {
    row.article = `ERROR ${failureDetail(env, error)}`;
  }

  row.ms = Date.now() - started;
  return row;
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2);
  const models = requested.length > 0 ? requested : CANDIDATES;
  const env = getEnv();
  if (!isLlmConfigured(env)) {
    console.error("LLM not configured (set LLM_BASE_URL, LLM_API_KEY, LLM_MODEL): model eval not run.");
    process.exit(1);
  }

  const rows: Row[] = [];
  // Sequential on purpose: two models in flight share the provider's per-minute budget, so each would be
  // measured against the other's load rather than on its own.
  for (const model of models) {
    const row = await evaluate(model, env);
    rows.push(row);
    console.log(`${model}: ${row.ms} ms`);
  }

  console.log("\n| model | expand | leaf rule | article length | citations | questions | ms |");
  console.log("|---|---|---|---|---|---|---|");
  for (const row of rows) {
    console.log(
      `| \`${row.model}\` | ${row.expand} | ${row.leaf} | ${row.article} | ${row.citations} | ${row.questions} | ${row.ms} |`,
    );
  }
}

void main().catch((error: unknown) => {
  console.error(failureDetail(getEnv(), error));
  process.exit(1);
});

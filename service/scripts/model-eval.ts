import "dotenv/config";
import { createExpandAgent } from "../src/application/agents/expand.agent";
import { verifyExpansion } from "../src/application/agents/verifier.agent";
import { buildWriterUserPrompt, WRITER_SYSTEM_PROMPT } from "../src/application/agents/writer.prompt";
import { createStructuredGenerator } from "../src/application/llm/structured";
import type { LlmCallEvent, ReasoningEffort } from "../src/application/ports/llm.port";
import { QUIZ_CONFIG, REASONING_EFFORTS } from "../src/config/constants";
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
// Three calls per model: expand at an interior layer, expand at the layer above the leaves (whose briefs must
// stand alone, C99), and one writer call.
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
const CHILDREN = [
  { topic: "Paging", brief: "Fixed-size pages and frames, and how they remove external fragmentation." },
  { topic: "Page replacement", brief: "Choosing which page to evict when memory is full." },
  { topic: "Address translation", brief: "Turning virtual addresses into physical ones with page tables and a TLB." },
];

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
  final: string;
  article: string;
  citations: string;
  questions: string;
  // What each request actually went out as and cost: format, effort, completion (reasoning) tokens (C116).
  requests: string;
  // Parameters the model refused by name and the adapter stopped sending (C113, C114).
  refused: string;
  ms: number;
};

const ok = (pass: boolean, detail: string): string => `${pass ? "PASS" : "FAIL"} ${detail}`;

const ancestor = (depth: number) => ({ depth, topic: PARENT.topic, brief: PARENT.brief });

function contextAt(depth: number, maxDepth: number, position: NodeContext["position"]): NodeContext {
  return { depth, maxDepth, position, ancestors: [ancestor(depth - 1)] };
}

// `id` or `id@effort`, like an .env pool entry, so a ceiling can be measured before it is configured.
function parseCandidate(raw: string): { model: string; effort: ReasoningEffort | undefined } {
  const at = raw.lastIndexOf("@");
  if (at === -1) return { model: raw, effort: undefined };
  const effort = raw.slice(at + 1);
  if (!(REASONING_EFFORTS as readonly string[]).includes(effort)) throw new Error(`unknown effort in "${raw}"`);
  return { model: raw.slice(0, at), effort: effort as ReasoningEffort };
}

async function evaluate(candidate: string, env: Env): Promise<Row> {
  const profile = requireLlmEnv(env);
  const { model, effort } = parseCandidate(candidate);
  // A ceiling configured for this model in .env applies unless the argument names its own.
  const configured = [...profile.models, ...(profile.writerModels ?? [])].find((m) => m.id === model);
  const events: LlmCallEvent[] = [];
  const refused: string[] = [];
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
      maxReasoningEffort: effort ?? configured?.maxReasoningEffort,
      onCall: (event) => void events.push(event),
      logger: {
        debug: () => {},
        warn: (_msg, context) => void refused.push(String(context?.feature ?? "?")),
      },
    }),
  );
  const expand = createExpandAgent({ generate }).expand;
  const row: Row = {
    model: candidate,
    expand: "-",
    final: "-",
    article: "-",
    citations: "-",
    questions: "-",
    requests: "-",
    refused: "-",
    ms: 0,
  };
  const started = Date.now();

  try {
    const output = await expand({ topic: TOPIC, brief: PARENT.brief, context: contextAt(1, 3, "normal") });
    const verified = verifyExpansion({ output, topic: TOPIC, ancestors: [ancestor(0)], isRoot: false });
    row.expand = ok(verified.output.children.length > 0, `${verified.output.children.length} children`);
  } catch (error) {
    row.expand = `ERROR ${failureDetail(env, error)}`;
  }

  try {
    // The children of this call are the final layer and are never called themselves, so every brief must be
    // valid as written: what this measures is how many the verifier had to drop.
    const output = await expand({ topic: TOPIC, brief: PARENT.brief, context: contextAt(2, 3, "taper") });
    const verified = verifyExpansion({ output, topic: TOPIC, ancestors: [ancestor(1)], isRoot: false });
    const kept = verified.output.children.length;
    row.final = ok(kept > 0 && verified.droppedChildren === 0, `${kept} kept, ${verified.droppedChildren} dropped`);
  } catch (error) {
    row.final = `ERROR ${failureDetail(env, error)}`;
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
  row.requests = events
    .map(
      (e) =>
        `${e.label}: ${e.responseFormat}/${e.reasoningEffort ?? "default"} ` +
        `${e.completionTokens ?? "?"}t (${e.reasoningTokens ?? 0}r) ${e.ms}ms${e.finishReason === "length" ? " TRUNCATED" : ""}`,
    )
    .join("; ");
  row.refused = refused.length === 0 ? "none" : refused.join(", ");
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

  console.log(
    "\n| model | expand | final-layer briefs | article length | citations | questions | refused | ms |",
  );
  console.log("|---|---|---|---|---|---|---|---|");
  for (const row of rows) {
    console.log(
      `| \`${row.model}\` | ${row.expand} | ${row.final} | ${row.article} | ${row.citations} | ${row.questions} | ${row.refused} | ${row.ms} |`,
    );
  }
  console.log("\nRequests (format/effort, completion tokens (reasoning), latency):");
  for (const row of rows) console.log(`- \`${row.model}\`: ${row.requests}`);
}

void main().catch((error: unknown) => {
  console.error(failureDetail(getEnv(), error));
  process.exit(1);
});

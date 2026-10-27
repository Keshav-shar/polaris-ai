import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { assessGroundedness, checkCredibility, checkQuizSanity } from "../src/application/agents/guardrail.agent";
import { createRetrievalAgent } from "../src/application/agents/retrieval.agent";
import { buildWriterUserPrompt, WRITER_SYSTEM_PROMPT } from "../src/application/agents/writer.prompt";
import { createStructuredGenerator } from "../src/application/llm/structured";
import type { LlmCallEvent, ReasoningEffort } from "../src/application/ports/llm.port";
import { createSearchFromEnv } from "../src/composition/search";
import { type Env, getEnv, isLlmConfigured, requireLlmEnv } from "../src/config/env";
import { QuotaExhaustedError } from "../src/domain/errors/quota-exhausted.error";
import { ArticleContext, WriterOutput } from "../src/domain/schemas/article.schema";
import type { EvidenceItem } from "../src/domain/schemas/evidence.schema";
import { articleBudget } from "../src/domain/traversal/article-budget";
import { createOpenAiCompatibleLlm } from "../src/infrastructure/llm/openai-compatible.adapter";
import { countWords } from "../src/shared/words";
import { failureDetail } from "./redact";

// Does the writer hallucinate more at a lower reasoning effort? Paired comparison: the SAME contexts and the
// SAME retrieved evidence go to every arm (model x effort x repeat), so a difference between arms is the
// effort, not the day's search results. Measures, per call and BEFORE any filtering:
//   - citations whose url is not one of the sources given      (invented source)
//   - questions whose evidenceUrl is not one of the sources    (invented source)
//   - quizzes with a sanity problem (C125)                      (broken quiz)
//   - citations whose claim its own source does not support   (C124, lexical; a proxy - see the decision rule)
// Decision rule (user, 2026-10-07): `low` passes only with ZERO invented sources, ZERO broken quizzes, and an
// ungrounded-citation share no higher than `medium`'s on the same contexts.
//
// Cost: models x efforts x CONTEXTS.length x repeat writer calls - 2 x 2 x 3 x 2 = 24 by default, ~5,500 tokens
// each (~130K, ~65K per model against 200K tokens/day), plus 3 Wikipedia searches. A daily-quota 429 stops the
// run at once and prints what it has.
//
// Usage: npm run writer-eval [-- --repeat 2 --efforts medium,low --models a,b --save out.json]
//        npm run writer-eval -- --rescore out.json     (re-score saved replies; no LLM call, no search)

type NodeSpec = {
  topic: string;
  depth: number;
  brief: string;
  parent: { topic: string; brief: string };
  children: { topic: string; brief: string }[];
};

// An interior node, a leaf, and a narrower topic where evidence tends to be thinner.
const CONTEXTS: readonly NodeSpec[] = [
  {
    topic: "Memory paging",
    depth: 1,
    brief: "How an operating system divides memory into fixed-size pages and maps them to physical frames.",
    parent: { topic: "Memory management", brief: "How an operating system allocates, protects and reclaims memory." },
    children: [
      { topic: "Page table", brief: "The per-process structure that maps virtual pages to physical frames." },
      { topic: "Page replacement", brief: "How the system chooses which page to evict when memory is full." },
      { topic: "Translation lookaside buffer", brief: "The cache that speeds up virtual-to-physical translation." },
    ],
  },
  {
    topic: "Translation lookaside buffer",
    depth: 2,
    brief: "The hardware cache of recent virtual-to-physical address translations, and how misses are handled.",
    parent: { topic: "Memory paging", brief: "How memory is divided into pages mapped to physical frames." },
    children: [],
  },
  {
    topic: "Byzantine fault tolerance",
    depth: 1,
    brief: "How a distributed system keeps agreeing on state when some nodes fail or behave arbitrarily.",
    parent: { topic: "Distributed computing", brief: "Systems of networked computers that coordinate to share work." },
    children: [
      { topic: "Byzantine generals problem", brief: "The thought experiment that defines arbitrary-failure consensus." },
      { topic: "Practical Byzantine Fault Tolerance", brief: "A replication algorithm that tolerates f faulty of 3f+1 nodes." },
    ],
  },
];

type Sample = {
  model: string;
  effort: ReasoningEffort;
  context: string;
  // Samples sharing a pair id saw the same context in the same round; only complete pairs are scored, so a
  // run cut short by the daily quota still compares like with like.
  pair: string;
  output?: WriterOutput;
  error?: string;
  completionTokens?: number;
  reasoningTokens?: number;
  ms?: number;
};

// `planned` is how many samples the run set out to collect; a verdict needs all of them (see `report`).
type Saved = { evidence: Record<string, EvidenceItem[]>; samples: Sample[]; planned: number };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function contextFor(spec: NodeSpec, evidence: EvidenceItem[]): ArticleContext {
  return ArticleContext.parse({
    node: { id: "00000000-0000-4000-8000-000000000001", topic: spec.topic, depth: spec.depth, brief: spec.brief },
    parent: spec.parent,
    isLeaf: spec.children.length === 0,
    children: spec.children,
    evidence,
  });
}

async function collect(env: Env): Promise<Saved> {
  const llm = requireLlmEnv(env);
  const models = arg("models")?.split(",") ?? (llm.writerModels ?? llm.models).map((m) => m.id);
  const efforts = (arg("efforts")?.split(",") ?? ["medium", "low"]) as ReasoningEffort[];
  const repeat = Number(arg("repeat") ?? "2");

  // ONE retrieval per context, shared by every arm: the comparison is paired.
  const retrieval = createRetrievalAgent({ search: createSearchFromEnv(env) });
  const evidence: Record<string, EvidenceItem[]> = {};
  for (const spec of CONTEXTS) {
    const { items } = await retrieval.retrieve({ topic: spec.topic, parentTopic: spec.parent.topic });
    evidence[spec.topic] = checkCredibility(items).credible;
    console.log(`evidence ${spec.topic}: ${evidence[spec.topic]!.length} credible sources`);
  }

  const samples: Sample[] = [];
  const planned = models.length * efforts.length * CONTEXTS.length * repeat;
  for (const model of models) {
    const events: LlmCallEvent[] = [];
    // One generator per effort; the writer profile asks for `medium` and the ceiling clamps the low arm.
    // Nothing in production changes.
    const generators = new Map(
      efforts.map((effort) => [
        effort,
        createStructuredGenerator(
          createOpenAiCompatibleLlm({
            baseUrl: llm.baseUrl,
            apiKey: llm.apiKey,
            model,
            jsonMode: llm.jsonMode,
            maxConcurrency: 1,
            temperature: llm.temperature,
            seedMode: llm.seedMode,
            maxReasoningEffort: effort,
            onCall: (event) => void events.push(event),
          }),
        ),
      ]),
    );
    for (let r = 0; r < repeat; r++) {
      for (const spec of CONTEXTS) {
        const context = contextFor(spec, evidence[spec.topic]!);
        const pair = `${model}|${spec.topic}|${r}`;
        // Interleaved: each effort sees this context back to back, so a stop leaves complete pairs behind.
        for (const effort of efforts) {
          const before = events.length;
          const sample: Sample = { model, effort, context: spec.topic, pair };
          try {
            sample.output = await generators.get(effort)!({
              schema: WriterOutput,
              system: WRITER_SYSTEM_PROMPT,
              user: buildWriterUserPrompt(context, articleBudget(context.children.length)),
              label: "writer",
              seed: undefined,
            });
          } catch (error) {
            sample.error = failureDetail(env, error);
            if (error instanceof QuotaExhaustedError) {
              console.error(`STOPPED on a daily quota: ${sample.error}`);
              return { evidence, samples, planned };
            }
          }
          const calls = events.slice(before);
          sample.completionTokens = calls.reduce((sum, e) => sum + (e.completionTokens ?? 0), 0);
          sample.reasoningTokens = calls.reduce((sum, e) => sum + (e.reasoningTokens ?? 0), 0);
          sample.ms = calls.reduce((sum, e) => sum + e.ms, 0);
          samples.push(sample);
          console.log(`${model} ${effort} ${spec.topic} #${r + 1}: ${sample.error ?? "ok"}`);
        }
      }
    }
  }
  return { evidence, samples, planned };
}

type ArmScore = {
  samples: number;
  errors: number;
  inventedCitations: number;
  inventedQuestions: number;
  brokenQuizzes: number;
  judged: number;
  ungrounded: number;
  words: number[];
  completion: number[];
  reasoning: number[];
  flagged: string[];
};

function score(saved: Saved): Map<string, ArmScore> {
  const arms = new Map<string, ArmScore>();
  // Only complete pairs: every effort present for the same model, context and round.
  const efforts = new Set(saved.samples.map((sample) => sample.effort));
  const pairSizes = new Map<string, number>();
  for (const sample of saved.samples) pairSizes.set(sample.pair, (pairSizes.get(sample.pair) ?? 0) + 1);
  const complete = saved.samples.filter((sample) => pairSizes.get(sample.pair) === efforts.size);
  if (complete.length < saved.samples.length) {
    console.log(`(${saved.samples.length - complete.length} unpaired sample(s) left out of the comparison)`);
  }
  for (const sample of complete) {
    const key = `${sample.model}|${sample.effort}`;
    const arm = arms.get(key) ?? {
      samples: 0,
      errors: 0,
      inventedCitations: 0,
      inventedQuestions: 0,
      brokenQuizzes: 0,
      judged: 0,
      ungrounded: 0,
      words: [],
      completion: [],
      reasoning: [],
      flagged: [],
    };
    arms.set(key, arm);
    arm.samples += 1;
    if (sample.output === undefined) {
      arm.errors += 1;
      continue;
    }
    const evidence = saved.evidence[sample.context] ?? [];
    const allowed = new Set(evidence.map((item) => item.url));
    const known = sample.output.citations.filter((c) => allowed.has(c.url));
    arm.inventedCitations += sample.output.citations.length - known.length;
    const questions = sample.output.questions ?? [];
    arm.inventedQuestions += questions.filter((q) => !allowed.has(q.evidenceUrl)).length;
    if (questions.length > 0 && checkQuizSanity(questions, allowed).length > 0) arm.brokenQuizzes += 1;
    const report = assessGroundedness(known, evidence);
    arm.judged += report.grounded + report.ungrounded;
    arm.ungrounded += report.ungrounded;
    for (const v of report.verdicts) {
      if (v.verdict === "ungrounded") arm.flagged.push(`[${sample.context}] (${v.score.toFixed(2)}) ${v.citation.claim}`);
    }
    arm.words.push(countWords(sample.output.contentMd));
    arm.completion.push(sample.completionTokens ?? 0);
    arm.reasoning.push(sample.reasoningTokens ?? 0);
  }
  return arms;
}

const mean = (values: number[]) => (values.length === 0 ? 0 : Math.round(values.reduce((a, b) => a + b, 0) / values.length));
const share = (arm: ArmScore) => (arm.judged === 0 ? 0 : arm.ungrounded / arm.judged);

function report(saved: Saved): void {
  const arms = score(saved);
  console.log(
    "\n| model | effort | samples | errors | invented citation urls | invented question urls | broken quizzes | ungrounded / judged citations | citations per article | mean words | completion tokens (reasoning) |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const [key, arm] of arms) {
    const [model, effort] = key.split("|");
    console.log(
      `| \`${model}\` | ${effort} | ${arm.samples} | ${arm.errors} | ${arm.inventedCitations} | ${arm.inventedQuestions} | ` +
        `${arm.brokenQuizzes} | ${arm.ungrounded}/${arm.judged} (${(share(arm) * 100).toFixed(0)}%) | ` +
        `${arm.words.length === 0 ? 0 : (arm.judged / arm.words.length).toFixed(1)} | ${mean(arm.words)} | ` +
        `${mean(arm.completion)} (${mean(arm.reasoning)}) |`,
    );
  }
  for (const [key, arm] of arms) {
    if (arm.flagged.length === 0) continue;
    console.log(`\nUngrounded claims, ${key}:`);
    for (const line of arm.flagged) console.log(`  - ${line}`);
  }

  // The decision, per the rule stated at the top, over all writer models together.
  const byEffort = (effort: ReasoningEffort) => {
    const parts = [...arms].filter(([key]) => key.endsWith(`|${effort}`)).map(([, arm]) => arm);
    const total = parts.reduce<ArmScore>(
      (sum, arm) => ({
        ...sum,
        samples: sum.samples + arm.samples,
        errors: sum.errors + arm.errors,
        inventedCitations: sum.inventedCitations + arm.inventedCitations,
        inventedQuestions: sum.inventedQuestions + arm.inventedQuestions,
        brokenQuizzes: sum.brokenQuizzes + arm.brokenQuizzes,
        judged: sum.judged + arm.judged,
        ungrounded: sum.ungrounded + arm.ungrounded,
      }),
      { samples: 0, errors: 0, inventedCitations: 0, inventedQuestions: 0, brokenQuizzes: 0, judged: 0, ungrounded: 0, words: [], completion: [], reasoning: [], flagged: [] },
    );
    return total;
  };
  const low = byEffort("low");
  const medium = byEffort("medium");
  const reasons: string[] = [];
  // A verdict about "never" needs the whole planned sample: a run the daily quota cut short is a data point,
  // not a decision (it once printed PASS on a single pair).
  const scored = low.samples + medium.samples;
  if (scored < saved.planned) {
    console.log(`\nVERDICT: INCONCLUSIVE - ${scored} of ${saved.planned} planned samples were scored; re-run when quota allows.`);
    return;
  }
  if (low.samples === 0 || medium.samples === 0) reasons.push("both arms must have samples");
  if (low.errors > 0 || medium.errors > 0) reasons.push(`errors in a run (low ${low.errors}, medium ${medium.errors}): inconclusive`);
  if (low.samples !== medium.samples) reasons.push("arms are not the same size: inconclusive");
  if (low.inventedCitations > 0) reasons.push(`${low.inventedCitations} invented citation url(s) at low`);
  if (low.inventedQuestions > 0) reasons.push(`${low.inventedQuestions} invented question url(s) at low`);
  if (low.brokenQuizzes > 0) reasons.push(`${low.brokenQuizzes} broken quiz(zes) at low`);
  if (share(low) > share(medium)) {
    reasons.push(`ungrounded share at low ${(share(low) * 100).toFixed(0)}% > medium ${(share(medium) * 100).toFixed(0)}%`);
  }
  console.log(
    reasons.length === 0
      ? "\nVERDICT: low PASSES the rule - the writer may be downgraded to `low`."
      : `\nVERDICT: low does NOT pass - keep \`medium\`. ${reasons.join("; ")}.`,
  );
}

async function main(): Promise<void> {
  const rescore = arg("rescore");
  if (rescore !== undefined) {
    report(JSON.parse(readFileSync(rescore, "utf8")) as Saved);
    return;
  }
  const env = getEnv();
  if (!isLlmConfigured(env)) {
    console.error("LLM not configured (set LLM_BASE_URL, LLM_API_KEY, LLM_MODEL): writer eval not run.");
    process.exit(1);
  }
  const saved = await collect(env);
  const out = arg("save");
  if (out !== undefined) writeFileSync(out, JSON.stringify(saved, null, 2));
  report(saved);
}

void main().catch((error: unknown) => {
  console.error(failureDetail(getEnv(), error));
  process.exit(1);
});

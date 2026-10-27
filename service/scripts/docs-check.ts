import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  ANCESTOR_WINDOW,
  ARTICLE,
  BRIEF_MAX_WORDS,
  CREDIBILITY,
  DEFAULT_MAX_DEPTH,
  EXPAND,
  LLM,
  MAX_CONCURRENT_RUNS,
  MAX_DEPTH_CEILING,
  MAX_NODES_PER_RUN,
  NODE_STATE_TTL_DAYS,
  QUEUE,
  QUIZ_CONFIG,
  RETRIEVAL,
  ROOT_DEPTH,
  RUNS_LIST_LIMIT,
  TAPER_LAYERS,
  WORKER,
} from "../src/config/constants";

// Fails when a doc or README quotes a constant with a value the code no longer has, or repeats a claim the
// design has dropped (docs/conflicts.md C97: four copies of the constants block had drifted, three of them
// wrong). No network, no LLM. Run from service/: `npm run docs:check`.
//
// `docs/conflicts.md`, `docs/archive/` and TASK_PROGRESS_CONTEXT.md are skipped: they are history and quote
// old values on purpose.

const REPO = resolve(__dirname, "..", "..");

// The value each name has in code. A doc may name a constant without a number; only a quoted number is checked.
const VALUES: Readonly<Record<string, number>> = {
  ROOT_DEPTH,
  DEFAULT_MAX_DEPTH,
  MAX_DEPTH_CEILING,
  BRIEF_MAX_WORDS,
  ANCESTOR_WINDOW,
  TAPER_LAYERS,
  MAX_CHILDREN: EXPAND.MAX_CHILDREN,
  MAX_NODES_PER_RUN,
  MAX_CONCURRENT_RUNS,
  RUNS_LIST_LIMIT,
  MAX_RECEIVES: QUEUE.MAX_RECEIVES,
  SEND_BATCH_MAX: QUEUE.SEND_BATCH_MAX,
  STALL_MAX_RELEASES: QUEUE.STALL_MAX_RELEASES,
  NODE_STATE_TTL_DAYS,
  EXPAND_CONCURRENCY: WORKER.EXPAND_CONCURRENCY,
  ARTICLE_CONCURRENCY: WORKER.ARTICLE_CONCURRENCY,
  MAX_REPAIR_ATTEMPTS: LLM.MAX_REPAIR_ATTEMPTS,
  MAX_RETRIES: LLM.MAX_RETRIES,
  MIN_SCORE: CREDIBILITY.MIN_SCORE,
  MIN_CREDIBLE_SOURCES: CREDIBILITY.MIN_CREDIBLE_SOURCES,
  MAX_RESULTS: RETRIEVAL.MAX_RESULTS,
  MAX_WORDS: ARTICLE.MAX_WORDS,
  QUESTIONS_PER_TOPIC: QUIZ_CONFIG.QUESTIONS_PER_TOPIC,
  PASSING_SCORE_PERCENT: QUIZ_CONFIG.PASSING_SCORE_PERCENT,
  MAX_GUARDRAIL_RETRIES: QUIZ_CONFIG.MAX_GUARDRAIL_RETRIES,
};

// Claims the design dropped. Each names the decision that dropped it, which is what the failure prints.
const RETIRED: readonly { text: string; why: string }[] = [
  { text: "quizzes (on demand)", why: "questions come from the writer call (C74)" },
  { text: "+1 LLM call per opened node", why: "questions cost no extra call (C74)" },
  { text: "over the finished tree", why: "articles run beside construction (C91)" },
  { text: "`throttle` (default)", why: "`round-robin` is the default rotation (C92)" },
  { text: "node-builder-mvp-spec.md", why: "archived; point at docs/archive/ or the code (C97)" },
  { text: "polaris-implementation-plan.md", why: "archived; point at docs/archive/ (C97)" },
  { text: "quiz.prompt.ts", why: "no separate quiz agent exists (C74)" },
  { text: "failover.adapter.ts", why: "deleted with the second provider (C93)" },
  { text: "parser.agent.ts", why: "no parser; the root expansion names the topic (C100)" },
  { text: "smoke:parser", why: "deleted with the parser (C100)" },
  { text: "consolidator.agent.ts", why: "no consolidator; trimmed in teaching order (C101)" },
  { text: "estimate-expand-calls", why: "replaced by estimate-calls.ts (C99)" },
  { text: "estimateExpandCalls", why: "replaced by estimateCalls (C99)" },
  { text: "llmKeys", why: "replaced by secretValues (C103)" },
  { text: "1 + 2N", why: "the budget is I + N since C99/C100" },
  { text: "leaves included", why: "the final layer is never called (C99)" },
  { text: "empty children list", why: "the final layer is never called (C99)" },
  { text: "stubbed until after the MVP", why: "groundedness is live since 10.9 (C124)" },
  { text: "`skipped` stub", why: "groundedness is live since 10.9 (C124)" },
];

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "archive", "dist"]);
const SKIP_FILES = new Set(["docs/conflicts.md"]);

function markdownFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) markdownFiles(path, out);
    else if (name.endsWith(".md")) out.push(path);
  }
  return out;
}

function targets(): string[] {
  const files = [
    ...markdownFiles(join(REPO, "docs")),
    join(REPO, ".claude", "CLAUDE.md"),
    ...markdownFiles(join(REPO, "service", "src")),
    ...markdownFiles(join(REPO, "service", "scripts")),
    ...markdownFiles(join(REPO, "service", "tests")),
    ...markdownFiles(join(REPO, "ui", "src")),
    join(REPO, "ui", "README.md"),
    join(REPO, "infra", "README.md"),
  ];
  return files.filter((file) => !SKIP_FILES.has(relative(REPO, file).replaceAll("\\", "/")));
}

type Finding = { file: string; line: number; message: string };

// `NAME = 60`, `NAME` 60, `NAME: 60`, NAME 60 - but not `NAME - 1`, `NAME_OTHER`, `OTHER_NAME` or `C60`.
function quotedValues(line: string, name: string): number[] {
  const pattern = new RegExp(`(?<![A-Za-z0-9_])${name}\`?\\s*(?:=|:)?\\s*\`?(\\d[\\d_,]*(?:\\.\\d+)?)(?![\\d.]*[A-Za-z%])`, "g");
  return [...line.matchAll(pattern)].map((m) => Number(m[1]!.replace(/[_,]/g, "")));
}

function check(file: string): Finding[] {
  const findings: Finding[] = [];
  const rel = relative(REPO, file).replaceAll("\\", "/");
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((text, index) => {
      for (const [name, value] of Object.entries(VALUES)) {
        for (const quoted of quotedValues(text, name)) {
          if (quoted !== value) {
            findings.push({ file: rel, line: index + 1, message: `${name} quoted as ${quoted}, code has ${value}` });
          }
        }
      }
      // A struck-through or explicitly cancelled mention is the doc recording the retirement, not repeating it.
      const recordsRetirement = text.includes("~~") || /not being built/i.test(text);
      for (const { text: retired, why } of recordsRetirement ? [] : RETIRED) {
        if (text.includes(retired)) findings.push({ file: rel, line: index + 1, message: `"${retired}": ${why}` });
      }
    });
  return findings;
}

const files = targets();
const findings = files.flatMap(check);
for (const f of findings) console.log(`${f.file}:${f.line}  ${f.message}`);
console.log(findings.length === 0 ? `docs-check: OK (${files.length} files)` : `docs-check: ${findings.length} stale`);
process.exit(findings.length === 0 ? 0 : 1);

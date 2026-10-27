import { QUIZ_CONFIG } from "../../config/constants";
import { ArticleContext, WriterOutput } from "../../domain/schemas/article.schema";
import { articleBudget } from "../../domain/traversal/article-budget";
import type { GenerateStructured } from "../llm/structured";
import { buildWriterUserPrompt, WRITER_SYSTEM_PROMPT } from "./writer.prompt";

export type WriterAgent = {
  // `boosted`: a learner asked for this scroll, so its call jumps every other queued LLM call (C128, C129).
  write(context: ArticleContext, options?: { boosted?: boolean }): Promise<WriterOutput>;
};

// Keeps only citations whose url really is one of the node's sources. A model that cites a url it was not
// given has invented a source, and an invented citation is worse than none: it makes an unsupported claim
// look grounded. Same rule for a question's evidenceUrl.
function withKnownSourcesOnly(output: WriterOutput, allowed: ReadonlySet<string>): WriterOutput {
  // `questions` is taken OUT first: spreading the whole output and then "not re-adding" a bad set kept the
  // unfiltered one - invented source included - which is the bug C117 fixed.
  const { questions: proposed, ...rest } = output;
  const citations = rest.citations.filter((citation) => allowed.has(citation.url));
  const questions = proposed?.filter((question) => allowed.has(question.evidenceUrl));
  return {
    ...rest,
    citations,
    // Dropping a question leaves the set the wrong length, so the whole set goes rather than a short one:
    // QuizOutput is `.length(QUESTIONS_PER_TOPIC)` and a partial quiz would fail at storage anyway. An empty
    // list - what strict structured output returns when there is nothing to cite (C114) - is no quiz too.
    ...(questions === undefined || questions.length !== QUIZ_CONFIG.QUESTIONS_PER_TOPIC ? {} : { questions }),
  };
}

// One LLM call per node, returning the article AND its questions (docs/conflicts.md C74) - bundling them
// is what makes the questions free.
//
// Length comes from the node's own shape, not from a sitewide number: the band is derived here from the
// children the writer can see, and ARTICLE.MAX_WORDS remains only as the runaway guard the schema enforces,
// so a genuinely oversized draft is shortened by generateStructured's repair loop (C85).
export function createWriterAgent({ generate }: { generate: GenerateStructured }): WriterAgent {
  return {
    async write(context: ArticleContext, options = {}) {
      // Parsed, not trusted: the strictObject is what guarantees no children's material is in scope, and
      // asserting it here means a caller that built the context by hand cannot bypass that.
      const parsed = ArticleContext.parse(context);
      // Derived from the children actually in scope, so a node whose children all failed is budgeted as
      // the leaf it has effectively become - the same rule `isLeaf` already follows.
      const budget = articleBudget(parsed.children.length);
      const output = await generate({
        schema: WriterOutput,
        system: WRITER_SYSTEM_PROMPT,
        user: buildWriterUserPrompt(parsed, budget),
        label: "writer",
        seed: undefined,
        // Shallower scrolls first: a learner reads top-down, and a parent signposts its children (C129).
        priority: { lane: options.boosted === true ? "boosted-article" : "article", depth: parsed.node.depth },
      });
      const allowed = new Set(parsed.evidence.map((item) => item.url));
      return withKnownSourcesOnly(output, allowed);
    },
  };
}

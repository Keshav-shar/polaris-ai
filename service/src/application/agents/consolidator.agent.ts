import { EXPAND } from "../../config/constants";
import { ConsolidatorOutput } from "../../domain/schemas/agent-io.schema";
import type { AncestorRef } from "../../domain/schemas/node.schema";
import { cleanChildren } from "../../domain/traversal/clean-children";
import type { GenerateStructured } from "../llm/structured";
import { buildConsolidatorUserPrompt, CONSOLIDATOR_SYSTEM_PROMPT } from "./consolidator.prompt";

export type ConsolidateRequest = {
  topic: string;
  ancestors: readonly AncestorRef[];
  children: readonly string[];
  seed?: number;
};

export type ConsolidatorAgent = {
  consolidate(request: ConsolidateRequest): Promise<string[]>;
};

// Maps groups back to topics. Throws on an out-of-range or reused index (the caller falls back to a plain trim).
// A single-member group keeps its original text, so only merged groups carry model-written names.
export function applyConsolidation(
  children: readonly string[],
  output: ConsolidatorOutput,
  blocked: readonly string[] = [],
): string[] {
  const used = new Set<number>();
  const topics = output.groups.map(({ members, topic }) => {
    for (const m of members) {
      if (m > children.length) throw new RangeError(`consolidator index ${m} is out of range`);
      if (used.has(m)) throw new RangeError(`consolidator index ${m} is used twice`);
      used.add(m);
    }
    return members.length === 1 ? children[members[0]! - 1]! : topic;
  });
  return cleanChildren(topics, blocked).slice(0, EXPAND.MAX_CHILDREN);
}

// Called only when a node has more than EXPAND.MAX_CHILDREN children after verification: 1 extra LLM call.
export function createConsolidatorAgent({ generate }: { generate: GenerateStructured }): ConsolidatorAgent {
  return {
    async consolidate({ topic, ancestors, children, seed }) {
      const output = await generate({
        schema: ConsolidatorOutput,
        system: CONSOLIDATOR_SYSTEM_PROMPT,
        user: buildConsolidatorUserPrompt(topic, ancestors, children),
        label: "consolidate",
        seed,
      });
      return applyConsolidation(children, output, [topic, ...ancestors.map((a) => a.topic)]);
    },
  };
}

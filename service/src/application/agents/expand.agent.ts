import { ExpandOutput, type NodeContext } from "../../domain/schemas/node.schema";
import type { GenerateStructured } from "../llm/structured";
import { buildExpandUserPrompt, EXPAND_SYSTEM_PROMPT } from "./expand.prompt";

export type ExpandRequest = { topic: string; context: NodeContext; seed?: number };

export type ExpandAgent = {
  expand(request: ExpandRequest): Promise<ExpandOutput>;
};

// One LLM call per node. Output is schema-checked here; cleaning and the leaf rule belong to the verifier.
export function createExpandAgent({ generate }: { generate: GenerateStructured }): ExpandAgent {
  return {
    expand: ({ topic, context, seed }) =>
      generate({
        schema: ExpandOutput,
        system: EXPAND_SYSTEM_PROMPT,
        user: buildExpandUserPrompt(topic, context),
        label: "expand",
        seed,
      }),
  };
}

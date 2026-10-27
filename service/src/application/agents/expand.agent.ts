import { ExpandOutput, type NodeContext, type RawExpansion, RootExpandOutput } from "../../domain/schemas/node.schema";
import type { GenerateStructured } from "../llm/structured";
import {
  buildExpandUserPrompt,
  buildRootExpandUserPrompt,
  EXPAND_SYSTEM_PROMPT,
  ROOT_EXPAND_SYSTEM_PROMPT,
} from "./expand.prompt";

// `request` is set for the root only: the learner's raw text, which the root call reads to name the topic
// (C100). `brief` is the node's own brief as its parent wrote it (C99).
export type ExpandRequest = {
  topic: string;
  brief?: string | undefined;
  request?: string | undefined;
  context: NodeContext;
  seed?: number | undefined;
};

export type ExpandAgent = {
  expand(request: ExpandRequest): Promise<RawExpansion>;
};

// One LLM call per interior node, the root included. Output is schema-checked here; cleaning, the per-child
// brief check and the caps belong to the verifier and the use-case.
export function createExpandAgent({ generate }: { generate: GenerateStructured }): ExpandAgent {
  return {
    expand: ({ topic, brief, request, context, seed }) =>
      request === undefined
        ? generate({
            schema: ExpandOutput,
            system: EXPAND_SYSTEM_PROMPT,
            user: buildExpandUserPrompt(topic, brief ?? "", context),
            label: "expand",
            seed,
            // Construction outranks every article that is not boosted: each scroll below waits on it (C129).
            priority: { lane: "expand", depth: context.depth },
          })
        : generate({
            schema: RootExpandOutput,
            system: ROOT_EXPAND_SYSTEM_PROMPT,
            user: buildRootExpandUserPrompt(request, context),
            label: "expand-root",
            seed,
            priority: { lane: "expand", depth: context.depth },
          }),
  };
}

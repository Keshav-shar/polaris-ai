import type { ChatMessage, ChatOptions, LlmPort } from "../../application/ports/llm.port";

// An LlmPort that can report WHO answered and WHICH cache namespace its answers belong to. The two are
// deliberately separate:
//
//   activeModel()    - the model that answered most recently. Reporting only (smoke output, logs). Under
//                      a rotating pool it changes per call, so it must NEVER be used as a cache key.
//   cacheNamespace() - identifies the SET of models that may answer, not the one that did. Stable for the
//                      lifetime of the process under a pool.
//
// Splitting them fixes a real defect: construct-node.ts computes the expansion-cache key BEFORE the LLM
// call and writes the result with that same key AFTER it. With a per-call rotation keyed on the answering
// model, an answer from model B would be filed under model A's namespace - not merely fragmented, but
// wrong - and a redelivered node landing on a different member would miss and pay for a second expansion.
export type SwitchableLlm = LlmPort & {
  activeModel(): string;
  cacheNamespace(): string;
};

// Wraps a single-model port. Namespace === model, which is exactly the key material used before the split,
// so no existing cache entry is invalidated and PROMPT_VERSION does not need a bump.
export function fixedModelLlm(llm: LlmPort, model: string): SwitchableLlm {
  return {
    chat: (messages: readonly ChatMessage[], options?: ChatOptions) => llm.chat(messages, options),
    activeModel: () => model,
    cacheNamespace: () => model,
  };
}

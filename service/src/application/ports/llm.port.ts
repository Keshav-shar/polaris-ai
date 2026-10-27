import type { LLM_PRIORITY_LANES, REASONING_EFFORTS } from "../../config/constants";

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

// Where a call waits when every LLM slot is busy: its lane first, then its node's depth (shallower first),
// then arrival order (C129).
export type ChatPriority = { lane: keyof typeof LLM_PRIORITY_LANES; depth: number };

// A JSON Schema the provider can enforce while decoding (strict structured output), already reduced to the
// subset strict mode accepts (application/llm/json-schema.ts).
export type ResponseSchema = { name: string; schema: Record<string, unknown> };

export type ChatOptions = {
  // Ask for a JSON object. Adapters may ignore this if the provider has no JSON mode.
  json?: boolean;
  // With `json`: the exact shape wanted. An adapter whose model supports strict structured output sends it,
  // so the reply cannot be malformed; one that does not falls back to plain JSON mode (C114).
  responseSchema?: ResponseSchema;
  // Per-call override. Adapters send a temperature only when one is configured for the provider.
  temperature?: number;
  // Sampling seed for repeatable output. Adapters send it only when seeding is enabled.
  seed?: number;
  // How much a reasoning model should think. An adapter clamps it to its model's configured maximum and
  // drops it for a model that rejects the parameter (C113).
  reasoningEffort?: ReasoningEffort;
  // Optional cap on output, reasoning included. No label sets one: a cap inflates Groq's admission estimate (C112).
  maxCompletionTokens?: number;
  // Who is calling (`expand`, `writer`, ...), for the per-call event and usage totals only.
  label?: string;
  // Queue position for a slot. Unset = the back of the article lane, so an unlabelled caller never jumps ahead.
  priority?: ChatPriority;
};

// One completed provider request, as an adapter reports it (C116). Tokens are what the provider billed;
// `undefined` when it did not say.
export type LlmCallEvent = {
  label: string;
  model: string;
  ms: number;
  promptTokens: number | undefined;
  completionTokens: number | undefined;
  reasoningTokens: number | undefined;
  finishReason: string | undefined;
  responseFormat: "json_schema" | "json_object" | "text";
  reasoningEffort: ReasoningEffort | undefined;
};

export interface LlmPort {
  chat(messages: readonly ChatMessage[], options?: ChatOptions): Promise<string>;
}

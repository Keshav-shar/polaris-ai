export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export type ChatOptions = {
  // Ask for a JSON object. Adapters may ignore this if the provider has no JSON mode.
  json?: boolean;
  // Per-call override. Adapters send a temperature only when one is configured for the provider.
  temperature?: number;
  // Sampling seed for repeatable output. Adapters send it only when seeding is enabled.
  seed?: number;
};

export interface LlmPort {
  chat(messages: readonly ChatMessage[], options?: ChatOptions): Promise<string>;
}

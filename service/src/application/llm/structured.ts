import { z } from "zod";
import { LLM, TEMPERATURE_BY_LABEL } from "../../config/constants";
import { StructuredOutputError } from "../../domain/errors/structured-output.error";
import type { ChatMessage, ChatOptions, LlmPort } from "../ports/llm.port";

export type JsonExtraction = { ok: true; value: unknown } | { ok: false; error: string };

const FENCE = /```(?:json)?\s*([\s\S]*?)```/i;

// Models wrap JSON in code fences or prose; take the fenced body, else the outermost braces.
export function extractJson(text: string): JsonExtraction {
  const fenced = FENCE.exec(text)?.[1];
  let candidate = fenced ?? text;
  if (fenced === undefined) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end < start) return { ok: false, error: "No JSON object found in the reply." };
    candidate = text.slice(start, end + 1);
  }
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch (error) {
    return { ok: false, error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export type StructuredRequest<S extends z.ZodType> = {
  schema: S;
  system: string;
  user: string;
  // Names the caller in errors and logs (e.g. "parser").
  label: string;
  // Defaults to TEMPERATURE_BY_LABEL[label]; the adapter ignores it unless a provider temperature is configured.
  temperature?: number;
  // Sampling seed (e.g. seedFor(nodeId)); the adapter ignores it unless seeding is enabled.
  seed?: number;
};

export type GenerateStructured = <S extends z.ZodType>(request: StructuredRequest<S>) => Promise<z.infer<S>>;

// Transport errors from the port propagate unchanged; only invalid output is repaired.
export function createStructuredGenerator(llm: LlmPort): GenerateStructured {
  return async ({ schema, system, user, label, temperature, seed }) => {
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];
    const options: ChatOptions = { json: true, temperature: temperature ?? TEMPERATURE_BY_LABEL[label], seed };
    let lastError = "";

    for (let attempt = 0; attempt <= LLM.MAX_REPAIR_ATTEMPTS; attempt++) {
      const reply = await llm.chat(messages, options);
      const extracted = extractJson(reply);
      if (extracted.ok) {
        const parsed = schema.safeParse(extracted.value);
        if (parsed.success) return parsed.data;
        lastError = z.prettifyError(parsed.error);
      } else {
        lastError = extracted.error;
      }
      messages.push(
        { role: "assistant", content: reply },
        {
          role: "user",
          content: `Your reply was invalid:\n${lastError}\nReply with only the corrected JSON object.`,
        },
      );
    }

    throw new StructuredOutputError(label, lastError);
  };
}

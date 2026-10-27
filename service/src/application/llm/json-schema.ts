import { z } from "zod";
import type { ResponseSchema } from "../ports/llm.port";

// Turns the Zod schema a reply is validated with into the JSON Schema a provider can ENFORCE while decoding
// (strict structured output, C114), so a reply cannot be malformed in the first place and the repair loop is
// left with only the rules a JSON Schema cannot say (word counts, http(s)-only URLs).
//
// Strict mode's own rules, measured against Groq on 2026-10-07:
//   - every object needs `additionalProperties: false` and EVERY property listed in `required`;
//   - `format` is rejected (`unknown or unsupported string format 'uri'`), so it is stripped - Zod still
//     checks the URL after the reply;
//   - minLength / maxLength / minItems / maxItems / pattern / minimum / maximum are accepted and kept,
//     because the decoder then enforces them for free.
// An optional property therefore becomes required: for WriterOutput that means `questions` is always
// present, as `[]` when there is nothing to cite - which the writer agent already treats as "no quiz".

const STRIPPED_KEYS = new Set(["$schema", "format", "default", "$id", "title", "description"]);

function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (typeof node !== "object" || node === null) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (STRIPPED_KEYS.has(key)) continue;
    out[key] = strictify(value);
  }
  const properties = out.properties;
  if (out.type === "object" && typeof properties === "object" && properties !== null) {
    out.additionalProperties = false;
    out.required = Object.keys(properties);
  }
  return out;
}

const cache = new WeakMap<z.ZodType, ResponseSchema | null>();

// undefined when the schema cannot be expressed (a transform with no JSON equivalent): the adapter then
// falls back to plain JSON mode, which is what every call did before C114. Memoized per schema object, so
// the conversion runs once per process, not once per call.
export function responseSchemaFor(schema: z.ZodType, name: string): ResponseSchema | undefined {
  const hit = cache.get(schema);
  if (hit !== undefined) return hit ?? undefined;
  let converted: ResponseSchema | null;
  try {
    const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "throw" });
    converted = { name, schema: strictify(json) as Record<string, unknown> };
  } catch {
    converted = null;
  }
  cache.set(schema, converted);
  return converted ?? undefined;
}

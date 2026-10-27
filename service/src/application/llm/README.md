# llm/

**Purpose:** Provider-agnostic structured output on top of `LlmPort`: ask for JSON, validate it with Zod, and repair on failure. Every agent that needs typed LLM output goes through this.

**May depend on:** domain (schemas, errors), `application/ports/llm.port.ts`, `config/constants` (`LLM.MAX_REPAIR_ATTEMPTS`), zod, shared.

**Must not depend on:** `infrastructure` (no SDKs, no concrete client), agents.

**Planned contents:**
- `structured.ts` (written in Phase 3) — `generateStructured({ schema, system, user, label })`: call chat in JSON mode, extract JSON (strip code fences, take the outermost braces), `safeParse`, on failure append the bad reply and the prettified Zod error and retry up to `MAX_REPAIR_ATTEMPTS`, then throw `StructuredOutputError(label, lastError)`. Built by a factory that receives the `LlmPort`. Since 10.7 every call also carries its label, the strict response schema and the label's `LLM_CALL_PROFILE` (reasoning effort; a completion cap only if a profile sets one, none does) (C112-C114).
- `json-schema.ts` (Phase 10.7, C114) — `responseSchemaFor(zodSchema, name)`: the validation schema as a strict-mode JSON Schema (objects closed and fully required, `format` stripped, length/count/range keywords kept), memoized per schema; undefined for a schema with no JSON equivalent, which falls back to plain JSON mode.

**Design notes:**
- The concurrency limiter and the OpenAI-compatible client live in `infrastructure/llm`, not here.

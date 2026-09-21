# llm/

**Purpose:** Provider-agnostic structured output on top of `LlmPort`: ask for JSON, validate it with Zod, and repair on failure. Every agent that needs typed LLM output goes through this.

**May depend on:** domain (schemas, errors), `application/ports/llm.port.ts`, `config/constants` (`LLM.MAX_REPAIR_ATTEMPTS`), zod, shared.

**Must not depend on:** `infrastructure` (no SDKs, no concrete client), agents.

**Planned contents:**
- `structured.ts` (written in Phase 3) — `generateStructured({ schema, system, user, label })`: call chat in JSON mode, extract JSON (strip code fences, take the outermost braces), `safeParse`, on failure append the bad reply and the prettified Zod error and retry up to `MAX_REPAIR_ATTEMPTS`, then throw `StructuredOutputError(label, lastError)`. Built by a factory that receives the `LlmPort`.

**Design notes:**
- The concurrency limiter and the OpenAI-compatible client live in `infrastructure/llm`, not here.

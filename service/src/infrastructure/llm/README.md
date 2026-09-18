# llm/

**Purpose:** LLM and embedding adapters for free-tier providers (Gemini, Groq, OpenRouter) behind `llm.port.ts` and `embedding.port.ts`.

**May depend on:** application/ports, domain, provider SDKs or fetch.

**Must not depend on:** Prompt content (belongs in agents).

**Planned contents:**
- `gemini.adapter.ts`, `groq.adapter.ts`, `openrouter.adapter.ts`
- `embedding.adapter.ts`
- `rate-limiter.ts` — free-tier quota handling with backoff and provider fallback

**Design notes:**
- Issue 6: the embedding dimension is coupled to the schema's `vector(1536)`; read it from `config/constants.ts` rather than hard-coding.

# fixtures/

**Purpose:** Shared test data and fakes.

**May depend on:** domain types, application/ports.

**Must not depend on:** Test framework globals.

**Planned contents:**
- `fake-generate.ts` — `fakeGenerate(result)` (records requests) and `fakeLogger()` → `{ logger, warnings, logs }`; `warnings` stays warn-only so older assertions keep their meaning (written in Phase 5, extended in 6.1)
- `fake-expander.ts` — `fakeExpander({ breadth, delayMs, childrenFor, failTimes, quotaAfter })`: deterministic children, per-topic failure counts, and a daily quota part-way through a build (Phase 6, `quotaAfter` 6.1)
- `fake-clock.ts` — a `Sleep` that records delays and resolves at once, so backoff is asserted rather than lived through (Phase 6)
- `build-harness.ts` — the whole in-memory construction stack with a fake expander: `build(prompt)`, plus `maxNodesPerRun` / `dailyRequestBudget` / `onFatal` hooks. The memory adapters ARE the test doubles (Phase 6)
- Fake expander (topic map → `{ brief, children }`, optional delay/failure), sample evidence, canned LLM replies, fake `LlmPort` / `SearchPort`

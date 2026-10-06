# credibility/

**Purpose:** Pure source-credibility rules: map a URL to a score in `[0, 1]` from its domain. Used by the article pass's evidence guardrail, not by construction.

**May depend on:** Itself and the standard library.

**Must not depend on:** Any I/O, network lookups, or application/infrastructure code.

**Planned contents:**
- `credibility-scorer.ts` — built (Phase 9). `scoreSource(url): number` plus
  `sourceIdentity(url): string | undefined` (the host, used to REPORT whether evidence is
  single-site; the gate itself counts distinct documents, because the default provider is
  Wikipedia-only). Suffix matching is dot-bounded, so `notreddit.com` cannot inherit reddit's score
  and `nih.gov.attacker.example` is not a government source. Scoring rules: `.gov` high; `.edu` / `.ac.*` high; known reference and academic publishers high; Wikipedia mid-high; forums and user-generated content (reddit, quora, medium, pinterest, and similar) low; unknown domains about 0.5; malformed URL 0 (Phase 9)

**Design notes:**
- Heuristic by design. It is deterministic so it is unit-testable, and it costs no extra LLM call per node.

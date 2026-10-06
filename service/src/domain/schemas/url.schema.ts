import { z } from "zod";

// Every URL that ends up as an `href` a reader can click: an evidence source, an article citation, a
// question's evidenceUrl.
//
// `z.url()` alone is NOT enough for that. It validates with the WHATWG parser, which accepts
// `javascript:alert(1)` as a perfectly well-formed URL - and these values are not ours: they come from a
// search provider's results (Tavily returns arbitrary web results) and pass through an LLM. The writer
// already drops any citation whose url was not in the evidence it was given, so a model cannot invent
// one; this closes the other half, where the evidence itself carries something that is not a web page.
//
// Checked at the DOMAIN boundary rather than in the UI, so every reader - the API, a future export, a
// Phase 12 migration - inherits it instead of re-deriving the rule.
export const HttpUrl = z.url().refine(
  (value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "must be an http(s) URL" },
);

import type { SearchPort } from "../application/ports/search.port";
import { type Env, EnvError } from "../config/env";
import { createTavilySearch } from "../infrastructure/search/tavily.adapter";
import { createWikipediaSearch } from "../infrastructure/search/wikipedia.adapter";

// The only place a search adapter is constructed. Wikipedia is the default because it needs no key and no
// quota beyond identifying itself; Tavily spends a metered monthly credit, so it is opt-in.
export function createSearchFromEnv(env: Env): SearchPort {
  if (env.SEARCH_PROVIDER === "tavily") {
    // env.ts already refuses SEARCH_PROVIDER=tavily without a key, so this is belt-and-braces for a
    // caller that built an Env by hand.
    if (!env.TAVILY_API_KEY) {
      throw new EnvError("TAVILY_API_KEY is required when SEARCH_PROVIDER=tavily (see docs/setup.md).");
    }
    return createTavilySearch({ apiKey: env.TAVILY_API_KEY });
  }
  // Wikipedia asks API clients to identify themselves; the fallback still names the project and version.
  return createWikipediaSearch({ userAgent: env.SEARCH_USER_AGENT ?? "polaris-ai/0.1" });
}

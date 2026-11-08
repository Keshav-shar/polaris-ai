import type { SearchPort } from "../application/ports/search.port";
import { type Env, EnvError, type SearchProviderName } from "../config/env";
import { createCachedSearch } from "../infrastructure/search/cached-search.adapter";
import { createCrossrefSearch } from "../infrastructure/search/crossref.adapter";
import { createGdeltSearch } from "../infrastructure/search/gdelt.adapter";
import { createIeeeXploreSearch } from "../infrastructure/search/ieee-xplore.adapter";
import { createMultiSourceSearch, type ProviderSearch } from "../infrastructure/search/multi-source-search.adapter";
import { createOpenAlexSearch } from "../infrastructure/search/openalex.adapter";
import { createTavilySearch } from "../infrastructure/search/tavily.adapter";
import { createWikipediaSearch } from "../infrastructure/search/wikipedia.adapter";
import type { Logger } from "../shared/logger";

// The only place search adapters are constructed. Every provider in SEARCH_PROVIDERS is searched in parallel for
// each lesson and the results merged breadth-first (C146); the bounded cache in front answers a redelivered
// article's repeat search without calling any provider again (C126).
export function createSearchFromEnv(env: Env, logger: Pick<Logger, "warn">): SearchPort {
  const providers = env.SEARCH_PROVIDERS.map((name) => providerSearch(env, name));
  return createCachedSearch(createMultiSourceSearch({ providers, logger }));
}

// The providers are asked to identify themselves; the fallback still names the project and version.
const userAgentOf = (env: Env): string => env.SEARCH_USER_AGENT ?? "polaris-ai/0.1";

function providerSearch(env: Env, name: SearchProviderName): ProviderSearch {
  const userAgent = userAgentOf(env);
  const contactEmail = env.SEARCH_CONTACT_EMAIL;
  switch (name) {
    case "wikipedia":
      return { provider: "wikipedia", port: createWikipediaSearch({ userAgent }) };
    case "crossref":
      return { provider: "crossref", port: createCrossrefSearch({ userAgent, ...(contactEmail ? { contactEmail } : {}) }) };
    case "gdelt":
      return { provider: "gdelt", port: createGdeltSearch({ userAgent }) };
    case "openalex":
      return {
        provider: "openalex",
        port: createOpenAlexSearch({ apiKey: requireKey(env.OPENALEX_API_KEY, "OPENALEX_API_KEY", name), userAgent, ...(contactEmail ? { contactEmail } : {}) }),
      };
    case "ieee":
      return { provider: "ieee", port: createIeeeXploreSearch({ apiKey: requireKey(env.IEEE_API_KEY, "IEEE_API_KEY", name) }) };
    case "tavily":
      return { provider: "tavily", port: createTavilySearch({ apiKey: requireKey(env.TAVILY_API_KEY, "TAVILY_API_KEY", name) }) };
  }
}

// env.ts already refuses a keyed provider without its key; this is belt-and-braces for a hand-built Env.
function requireKey(value: string | undefined, variable: string, provider: string): string {
  if (!value) throw new EnvError(`${variable} is required when SEARCH_PROVIDERS includes ${provider} (see docs/setup.md).`);
  return value;
}

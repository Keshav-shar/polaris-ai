import { SEARCH } from "../../config/constants";
import { TransportUnavailableError } from "../../domain/errors/transport-unavailable.error";
import { transportFaultCode } from "../../shared/transport-fault";

// Helpers every search adapter shares (C146): text cleaning, size bounds, the stall rule and one GET with a
// timeout. Moved here from wikipedia.adapter.ts unchanged when the adapters multiplied.

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// Providers mark matches with tags (MediaWiki `<span class="searchmatch">`, Crossref JATS `<jats:p>`) and encode
// entities. Snippets are quoted into a prompt as source text, so any markup left here would reach the model as
// noise - and tags a model might read as instructions have no business in evidence (agents-and-prompts.md:
// snippets are data, not instructions).
//
// Tags are stripped BEFORE entities are decoded, so an encoded `&lt;b&gt;` in an article about HTML survives
// as the literal text "<b>" - which is what the page says. That text is still untrusted: what stops it
// closing the prompt's <sources> block is dataBlock, which strips every variant of its own tag (C103).
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Search text is untrusted and quoted straight into the writer prompt, so its size is bounded here (C103).
export function capText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

// Title and snippet cleaned and bounded the same way for every provider.
export function cleanTitle(text: string): string {
  return capText(stripHtml(text), SEARCH.TITLE_MAX_CHARS);
}
export function cleanSnippet(text: string): string {
  return capText(stripHtml(text), SEARCH.SNIPPET_MAX_CHARS);
}

// A search that never completed - DNS, socket, our own timeout, including one that fires while the body is
// still arriving - is raised as a STALL, exactly as the LLM adapter raises one, so the article worker
// releases the message uncounted and with a delay instead of spending one of the node's receives on a
// network blip (docs/conflicts.md C94, C115). A response with a status, even a 5xx, is the provider
// answering and stays an ordinary error. A caller that aborted on purpose gets its abort back unchanged.
export async function withStallOnTransportFault<T>(
  provider: string,
  callerSignal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (callerSignal?.aborted) throw error;
    const fault = transportFaultCode(error);
    if (fault === undefined) throw error;
    throw new TransportUnavailableError(`the search provider (${provider})`, fault);
  }
}

// Our own timeout, plus the caller's cancellation if it gave one: a hung search must not hold a node's article
// hostage for the whole Lambda timeout.
export function requestSignal(timeoutMs: number, signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

export class ProviderHttpError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
  ) {
    // Names the provider and the status only: never a key, never the body (security.md).
    super(`${provider} search failed with HTTP ${status}`);
    this.name = "ProviderHttpError";
  }
}

// One JSON GET. A non-2xx is a ProviderHttpError; a body that is not JSON (GDELT answers its rate limit in plain
// text) is `undefined`, which every adapter reads as an empty result set.
export async function getJson(
  provider: string,
  url: string,
  options: { fetchImpl: FetchLike; timeoutMs: number; signal?: AbortSignal; headers?: Record<string, string> },
): Promise<unknown> {
  return withStallOnTransportFault(provider, options.signal, async () => {
    const response = await options.fetchImpl(url, {
      headers: { Accept: "application/json", ...options.headers },
      signal: requestSignal(options.timeoutMs, options.signal),
    });
    if (!response.ok) throw new ProviderHttpError(provider, response.status);
    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  });
}

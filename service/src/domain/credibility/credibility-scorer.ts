// Pure source-credibility rules: a URL's domain maps to a score in [0, 1]. Heuristic by design - it is
// deterministic, so it is unit-testable, and it costs no extra LLM call per node. Used only by the article
// pass's evidence guardrail, never by construction (docs/conflicts.md C05).

// Scores are deliberately coarse. What matters is which side of CREDIBILITY.MIN_SCORE (0.6) a source falls
// on, not whether a journal scores 0.9 or 0.92.
const SCORE = {
  GOVERNMENT: 0.95,
  ACADEMIC: 0.9,
  REFERENCE: 0.85,
  ENCYCLOPEDIA: 0.75,
  UNKNOWN: 0.5,
  USER_GENERATED: 0.25,
  MALFORMED: 0,
} as const;

// Suffix match on the registrable domain, so `nih.gov` and `data.cdc.gov` both count.
const GOVERNMENT_SUFFIXES = [".gov", ".gov.uk", ".mil", ".int", ".europa.eu"];
const ACADEMIC_SUFFIXES = [".edu", ".ac.uk", ".ac.jp", ".ac.in", ".edu.au", ".ac.nz", ".edu.cn"];

// Established reference works and academic publishers: not primary sources, but editorially reviewed.
const REFERENCE_HOSTS = [
  "britannica.com",
  "nature.com",
  "science.org",
  "sciencedirect.com",
  "springer.com",
  "link.springer.com",
  "jstor.org",
  "acm.org",
  "dl.acm.org",
  "ieee.org",
  "ieeexplore.ieee.org",
  "arxiv.org",
  "pubmed.ncbi.nlm.nih.gov",
  "plato.stanford.edu",
  "oed.com",
  "bbc.co.uk",
  "who.int",
];

// Wikipedia and its siblings sit just above the unknown-domain default: broad and usually accurate, but
// openly editable, so on their own two Wikipedia pages should not carry a node.
const ENCYCLOPEDIA_HOSTS = ["wikipedia.org", "wikimedia.org", "wiktionary.org", "wikibooks.org"];

// Forums, Q&A and self-publishing platforms. Often correct, never editorially accountable.
const USER_GENERATED_HOSTS = [
  "reddit.com",
  "quora.com",
  "medium.com",
  "pinterest.com",
  "tumblr.com",
  "facebook.com",
  "x.com",
  "twitter.com",
  "stackexchange.com",
  "stackoverflow.com",
  "blogspot.com",
  "wordpress.com",
  "substack.com",
  "youtube.com",
  "tiktok.com",
];

// `www.` is stripped so host lists stay readable; everything else is compared as a dot-bounded suffix, so
// `notreddit.com` cannot match `reddit.com`.
function hostOf(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  // A URL with no host (mailto:, data:, file:) is not a citable source.
  if (parsed.hostname === "") return undefined;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  return parsed.hostname.toLowerCase().replace(/^www\./, "");
}

// Dot-bounded suffix match, so `notreddit.com` cannot match `reddit.com` and
// `nih.gov.attacker.example` is not a government source. The bare form is compared too, because stripping
// `www.` turns `www.gov.uk` into exactly `gov.uk`, which no longer ends with `.gov.uk`.
function matches(host: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => {
    const bare = candidate.startsWith(".") ? candidate.slice(1) : candidate;
    return host === bare || host.endsWith(`.${bare}`);
  });
}

// A malformed or non-web URL scores 0 rather than the unknown default: it cannot be cited, so it must
// never help a node pass the credibility gate.
export function scoreSource(url: string): number {
  const host = hostOf(url);
  if (host === undefined) return SCORE.MALFORMED;
  if (matches(host, GOVERNMENT_SUFFIXES)) return SCORE.GOVERNMENT;
  if (matches(host, ACADEMIC_SUFFIXES)) return SCORE.ACADEMIC;
  if (matches(host, REFERENCE_HOSTS)) return SCORE.REFERENCE;
  if (matches(host, ENCYCLOPEDIA_HOSTS)) return SCORE.ENCYCLOPEDIA;
  if (matches(host, USER_GENERATED_HOSTS)) return SCORE.USER_GENERATED;
  return SCORE.UNKNOWN;
}

// The registrable-ish host, used to judge whether two sources are DISTINCT. Two pages of one site are one
// source for the credibility gate, or a single site could carry a node on its own.
export function sourceIdentity(url: string): string | undefined {
  return hostOf(url);
}

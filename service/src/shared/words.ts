export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

export function truncateToWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length <= maxWords ? text : words.slice(0, maxWords).join(" ");
}

// Function words that carry no claim. Small and fixed on purpose: the groundedness check (C124) asks "are
// the claim's CONTENT words in the source?", and a long list would start discarding words that matter.
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was", "one", "our", "out",
  "has", "have", "his", "how", "its", "may", "who", "did", "get", "use", "used", "uses", "using", "that",
  "this", "with", "from", "they", "them", "then", "than", "there", "their", "these", "those", "what", "when",
  "where", "which", "while", "will", "would", "could", "should", "also", "into", "onto", "upon", "such", "each",
  "other", "some", "more", "most", "many", "much", "very", "only", "same", "been", "being", "were", "does",
  "doing", "about", "over", "under", "between", "through", "during", "before", "after", "both", "either",
  "neither", "because", "often", "usually", "typically", "generally", "commonly", "called", "known", "well",
]);

// A claim or a source reduced to the words that carry its meaning: lowercased, split on anything that is
// not a letter or digit, function words and fragments under 3 characters dropped (numbers are kept at any
// length - they are what an invented claim most often gets wrong), and a plural `s` folded so "pages" meets
// "page". Pure and deterministic; no stemming library, because a wrong stem would make a claim look
// supported by a word it does not share.
export function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token !== "")
    .filter((token) => /^\p{N}+$/u.test(token) || (token.length >= 3 && !STOPWORDS.has(token)))
    .map((token) => (token.length > 3 && token.endsWith("s") && !token.endsWith("ss") ? token.slice(0, -1) : token));
}

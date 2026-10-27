import { MAX_DEPTH_CEILING } from "../../config/constants";

// "3 levels deep", "two layers", "depth 4", "depth of 2". Number words only up to the ceiling's range.
const WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const PATTERNS = [
  /\b(\d+|one|two|three|four|five|six)\s+(?:levels?|layers?)\b/i,
  /\bdepth\s*(?:of\s*|=\s*|:\s*)?(\d+|one|two|three|four|five|six)\b/i,
];

// The depth a learner STATED in their request, or undefined when they stated none. Pure and free: it replaced
// the parser LLM call, whose only other job - naming the topic - moved into the root expansion (C100).
// Clamped to [1, MAX_DEPTH_CEILING] like any other depth, so a request cannot raise the ceiling.
export function parseDepthHint(request: string): number | undefined {
  for (const pattern of PATTERNS) {
    const raw = pattern.exec(request)?.[1];
    if (raw === undefined) continue;
    const value = WORDS[raw.toLowerCase()] ?? Number.parseInt(raw, 10);
    if (!Number.isFinite(value)) continue;
    return Math.min(MAX_DEPTH_CEILING, Math.max(1, value));
  }
  return undefined;
}

import { normalizeTopic } from "./node-id";

// Trim, collapse whitespace, drop empties, dedupe (normalized) and drop blocked topics (the node's own and its
// ancestors': cycle guard). Keeps the input order, which later steps treat as teaching order. Generic over
// anything with a `topic`, so a child's brief travels with it (docs/conflicts.md C99).
export function cleanChildren<T extends { topic: string }>(children: readonly T[], blocked: readonly string[]): T[] {
  const seen = new Set(blocked.map(normalizeTopic));
  const out: T[] = [];
  for (const raw of children) {
    const topic = raw.topic.trim().replace(/\s+/g, " ");
    const key = normalizeTopic(topic);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...raw, topic });
  }
  return out;
}

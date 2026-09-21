import { normalizeTopic } from "./node-id";

// Trim, drop empties, dedupe (normalized) and drop blocked topics (the node's own and its ancestors': cycle guard).
// Keeps the input order, which later steps treat as importance.
export function cleanChildren(children: readonly string[], blocked: readonly string[]): string[] {
  const seen = new Set(blocked.map(normalizeTopic));
  const out: string[] = [];
  for (const raw of children) {
    const child = raw.trim().replace(/\s+/g, " ");
    const key = normalizeTopic(child);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(child);
  }
  return out;
}

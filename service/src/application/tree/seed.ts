// FNV-1a 32-bit: a stable, non-negative sampling seed per node, so a re-run of the same node asks for the same sample.
export function seedFor(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

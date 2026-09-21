// Dedup and child-id key: case, surrounding and repeated whitespace don't make a topic new.
export function normalizeTopic(topic: string): string {
  return topic.trim().replace(/\s+/g, " ").toLowerCase();
}

// ltree labels are built from ids, never titles; without hyphens they are valid on every Postgres version.
export function pathLabel(nodeId: string): string {
  return `n_${nodeId.replaceAll("-", "")}`;
}

export function childPath(parentPath: string, childId: string): string {
  return `${parentPath}.${pathLabel(childId)}`;
}

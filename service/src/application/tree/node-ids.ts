import { normalizeTopic } from "../../domain/traversal/node-id";
import { uuidV5 } from "../../shared/ids";

// Deterministic ids make a redelivered message recreate the same children (docs/aws-retrofit.md, rule 4).
export function rootNodeId(runId: string): string {
  return uuidV5("root", runId);
}

export function childNodeId(runId: string, parentId: string, topic: string): string {
  return uuidV5(`${parentId}|${normalizeTopic(topic)}`, runId);
}

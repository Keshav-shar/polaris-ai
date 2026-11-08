import { PutCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { DedupPort } from "../../application/ports/dedup.port";
import { normalizeTopic } from "../../domain/traversal/node-id";
import { expiresAt, isConditionalFailure } from "./dynamo-shared";

// Rule 7 on `dedup#<runId>#<normalizedTopic>` items: a topic is kept when its key is free OR already held by this
// same parent, so a retried parent keeps the topics it claimed on its first attempt instead of losing them to itself.
export function createDynamoDedupStore({
  client,
  tableName,
  now = Date.now,
}: {
  client: DynamoDBDocumentClient;
  tableName: string;
  now?: () => number;
}): DedupPort {
  return {
    async claimTopics(runId, claimantParentId, topics) {
      const kept: string[] = [];
      for (const topic of topics) {
        try {
          await client.send(
            new PutCommand({
              TableName: tableName,
              Item: { nodeId: `dedup#${runId}#${normalizeTopic(topic)}`, claimantParentId, expiresAt: expiresAt(now()) },
              ConditionExpression: "attribute_not_exists(nodeId) OR claimantParentId = :me",
              ExpressionAttributeValues: { ":me": claimantParentId },
            }),
          );
          kept.push(topic);
        } catch (error) {
          if (!isConditionalFailure(error)) throw error;
        }
      }
      return kept;
    },
  };
}

import { UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { RateWindowPort } from "../../application/ports/rate-window.port";
import { isConditionalFailure } from "./dynamo-shared";

const MINUTE_MS = 60_000;

// Amendment A13: one `rate#<key>#<epochMinute>` item per model per minute, shared by every warm Lambda container.
// A conditional ADD is the check AND the count in one write, so W containers stay inside a model's requests/minute.
// Items expire a few minutes after their minute ends.
export function createDynamoRateWindowStore({
  client,
  tableName,
}: {
  client: DynamoDBDocumentClient;
  tableName: string;
}): RateWindowPort {
  return {
    async tryAcquire(key, limit, nowMs) {
      const minute = Math.floor(nowMs / MINUTE_MS);
      try {
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { nodeId: `rate#${key}#${minute}` },
            UpdateExpression: "SET expiresAt = :exp ADD #c :one",
            ConditionExpression: "attribute_not_exists(#c) OR #c < :limit",
            ExpressionAttributeNames: { "#c": "count" },
            ExpressionAttributeValues: { ":one": 1, ":limit": limit, ":exp": Math.floor(((minute + 5) * MINUTE_MS) / 1000) },
          }),
        );
        return { ok: true };
      } catch (error) {
        if (!isConditionalFailure(error)) throw error;
        return { ok: false, retryAfterMs: (minute + 1) * MINUTE_MS - nowMs };
      }
    },
  };
}

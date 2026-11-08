import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { NODE_STATE_TTL_DAYS } from "../../config/constants";

export type DynamoConfig = { region: string; tableName: string; endpoint?: string | undefined };

// One document client per process. `removeUndefinedValues`: an optional field left undefined is simply not written,
// which is what every store below expects (an absent attribute, never a NULL).
export function createDynamoDocumentClient({ region, endpoint }: Omit<DynamoConfig, "tableName">): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region, ...(endpoint === undefined ? {} : { endpoint }) }), {
    marshallOptions: { removeUndefinedValues: true },
  });
}

// The SDK raises this when a ConditionExpression is false - for every store here that is an ANSWER ("already
// done", "already claimed"), not a failure. Matched by name: instanceof breaks across bundled copies of the SDK.
export function isConditionalFailure(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "ConditionalCheckFailedException";
}

// DynamoDB TTL is epoch SECONDS. Every in-flight item expires NODE_STATE_TTL_DAYS after it was created; TTL deletes
// are free and need no job.
export function expiresAt(nowMs: number, days: number = NODE_STATE_TTL_DAYS): number {
  return Math.floor(nowMs / 1000) + days * 86_400;
}

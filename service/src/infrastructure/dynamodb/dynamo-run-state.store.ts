import { GetCommand, UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { TerminalStatus } from "../../application/ports/node-state.port";
import type { RunStatePort } from "../../application/ports/run-state.port";
import { MAX_NODES_PER_RUN } from "../../config/constants";
import { RunState } from "../../domain/schemas/node-state.schema";
import { expiresAt, isConditionalFailure } from "./dynamo-shared";

// Concurrent parents racing for the last node slots retry this many times before giving up loudly. Each retry is
// one read and one conditional write; contention is bounded by W_expand, which is small.
const RESERVE_ATTEMPTS = 10;

// The `run#<runId>` item (amendment A3): ADD-counters, created on first use. nodesCreated starts at 1 - every run has
// a root before any child is reserved - which `if_not_exists` gives the first writer.
export function createDynamoRunStateStore({
  client,
  tableName,
  maxNodesPerRun = MAX_NODES_PER_RUN,
  now = Date.now,
}: {
  client: DynamoDBDocumentClient;
  tableName: string;
  maxNodesPerRun?: number;
  now?: () => number;
}): RunStatePort {
  const key = (runId: string) => ({ nodeId: `run#${runId}` });
  const toState = (runId: string, item: Record<string, unknown>): RunState => RunState.parse({ ...item, runId });

  // SET the identity fields once, ADD one counter, return the new totals.
  const add = async (runId: string, counter: string): Promise<RunState> => {
    const out = await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: key(runId),
        UpdateExpression:
          "SET runId = if_not_exists(runId, :run), nodesCreated = if_not_exists(nodesCreated, :one), " +
          `expiresAt = if_not_exists(expiresAt, :exp) ADD ${counter} :one`,
        ExpressionAttributeValues: { ":run": runId, ":one": 1, ":exp": expiresAt(now()) },
        ReturnValues: "ALL_NEW",
      }),
    );
    return toState(runId, out.Attributes ?? {});
  };

  return {
    countNode: (runId, status: TerminalStatus) => add(runId, status === "done" ? "nodesDone" : "nodesFailed"),
    countArticle: (runId, outcome: TerminalStatus) => add(runId, outcome === "done" ? "articlesDone" : "articlesFailed"),

    // Optimistic concurrency: read nodesCreated, write the new value only if it is still the one read. Everything
    // refused - by the branch cap or by the budget - is counted as skipped in the same write (C101).
    async reserveNodes(runId, requested, limit = requested) {
      if (!Number.isInteger(requested) || requested < 0) {
        throw new RangeError(`requested must be an integer >= 0, got ${requested}`);
      }
      for (let attempt = 0; attempt < RESERVE_ATTEMPTS; attempt += 1) {
        const current = (await client.send(new GetCommand({ TableName: tableName, Key: key(runId), ConsistentRead: true }))).Item;
        const created = typeof current?.nodesCreated === "number" ? current.nodesCreated : 1;
        const wanted = Math.min(requested, Math.max(0, limit));
        const granted = Math.min(wanted, Math.max(0, maxNodesPerRun - created));
        try {
          await client.send(
            new UpdateCommand({
              TableName: tableName,
              Key: key(runId),
              UpdateExpression:
                "SET runId = if_not_exists(runId, :run), nodesCreated = :next, expiresAt = if_not_exists(expiresAt, :exp) " +
                "ADD nodesSkipped :skipped",
              ConditionExpression:
                current?.nodesCreated === undefined ? "attribute_not_exists(nodesCreated)" : "nodesCreated = :seen",
              ExpressionAttributeValues: {
                ":run": runId,
                ":next": created + granted,
                ":exp": expiresAt(now()),
                ":skipped": requested - granted,
                ...(current?.nodesCreated === undefined ? {} : { ":seen": created }),
              },
            }),
          );
          return granted;
        } catch (error) {
          if (!isConditionalFailure(error)) throw error;
        }
      }
      throw new Error(`reserveNodes: run ${runId} stayed contended for ${RESERVE_ATTEMPTS} attempts`);
    },

    // A16: the first halt wins.
    async halt(runId, nowMs) {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: key(runId),
          UpdateExpression:
            "SET runId = if_not_exists(runId, :run), nodesCreated = if_not_exists(nodesCreated, :one), " +
            "haltedAt = if_not_exists(haltedAt, :now), expiresAt = if_not_exists(expiresAt, :exp)",
          ExpressionAttributeValues: { ":run": runId, ":one": 1, ":now": nowMs, ":exp": expiresAt(now()) },
        }),
      );
    },

    async get(runId) {
      const item = (await client.send(new GetCommand({ TableName: tableName, Key: key(runId) }))).Item;
      return item === undefined ? undefined : toState(runId, item);
    },
  };
}

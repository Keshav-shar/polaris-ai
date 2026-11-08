import { GetCommand, PutCommand, UpdateCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { ArticleDraftPort } from "../../application/ports/article-draft.port";
import type { NodeResult, NodeStatePort, TerminalStatus } from "../../application/ports/node-state.port";
import { ARTICLE } from "../../config/constants";
import { ArticleLeaseHeldError } from "../../domain/errors/article-lease-held.error";
import type { ArticleDraft } from "../../domain/schemas/article.schema";
import { NodeState } from "../../domain/schemas/node-state.schema";
import { expiresAt, isConditionalFailure } from "./dynamo-shared";

// The node item -> NodeState. DynamoDB returns the String Set as a Set and extra attributes (expiresAt) that
// NodeState strips. Parsed, never cast: the table is a trust boundary like any other.
function toState(item: Record<string, unknown>, article?: ArticleDraft): NodeState {
  const ids = item.completedChildIds;
  return NodeState.parse({
    ...item,
    completedChildIds: ids instanceof Set ? [...(ids as Set<string>)] : Array.isArray(ids) ? ids : [],
    ...(article === undefined ? {} : { article }),
  });
}

// The DynamoDB twin of memory-node-state.store.ts (Phase 13). Every method is ONE conditional write, which is what
// makes the numbered idempotency rules in docs/aws-retrofit.md hold under SQS's at-least-once delivery; a failed
// condition is an answer ("already finished"), read back with a consistent GetItem. Article drafts live in Postgres
// (A14/A23) and are read and written through `drafts`, so the port's contract is unchanged.
export function createDynamoNodeStateStore({
  client,
  tableName,
  drafts,
  now = Date.now,
}: {
  client: DynamoDBDocumentClient;
  tableName: string;
  drafts: ArticleDraftPort;
  now?: () => number;
}): NodeStatePort {
  const get = async (nodeId: string): Promise<Record<string, unknown> | undefined> =>
    (await client.send(new GetCommand({ TableName: tableName, Key: { nodeId }, ConsistentRead: true }))).Item;

  const update = async (
    nodeId: string,
    expression: string,
    condition: string,
    values: Record<string, unknown>,
    // `status`, `depth` and `result` are reserved words, so they go through #names. DynamoDB refuses an empty or
    // unused names map, hence only the ones an expression uses, and none at all when it uses none.
    names: Record<string, string> = {},
  ): Promise<Record<string, unknown> | undefined> => {
    try {
      const out = await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { nodeId },
          UpdateExpression: expression,
          ConditionExpression: condition,
          ...(Object.keys(names).length === 0 ? {} : { ExpressionAttributeNames: names }),
          ExpressionAttributeValues: values,
          ReturnValues: "ALL_NEW",
        }),
      );
      return out.Attributes;
    } catch (error) {
      if (isConditionalFailure(error)) return undefined;
      throw error;
    }
  };

  const TERMINAL = { ":done": "done", ":failed": "failed" } as const;

  return {
    // Rules 1 + 2. Creates the item if missing, counts the attempt and moves it to in_progress - unless it is
    // terminal (returned untouched) or already expanded (attempt counted, status KEPT, C144).
    async claim({ runId, nodeId, parentId, depth }) {
      const claimed = await update(
        nodeId,
        "SET runId = if_not_exists(runId, :run), parentId = if_not_exists(parentId, :parent), " +
          "#d = if_not_exists(#d, :depth), #s = :ip, expiresAt = if_not_exists(expiresAt, :exp), " +
          "completedChildren = if_not_exists(completedChildren, :zero), failedChildren = if_not_exists(failedChildren, :zero) " +
          "ADD attempts :one",
        "attribute_not_exists(nodeId) OR #s IN (:pending, :ip)",
        { ":run": runId, ":parent": parentId, ":depth": depth, ":ip": "in_progress", ":pending": "pending", ":exp": expiresAt(now()), ":zero": 0, ":one": 1 },
        { "#s": "status", "#d": "depth" },
      );
      if (claimed !== undefined) return toState(claimed);
      const expanded = await update(nodeId, "ADD attempts :one", "attribute_exists(nodeId) AND #s = :expanded", { ":one": 1, ":expanded": "expanded" }, { "#s": "status" });
      if (expanded !== undefined) return toState(expanded);
      const item = await get(nodeId);
      if (item === undefined) throw new Error(`claim: node ${nodeId} vanished between two writes`);
      return toState(item);
    },

    // Rules 2 + 3: result + expectedChildren + expanded in ONE write, only if no result is stored yet.
    async saveResult(nodeId, result: NodeResult) {
      const saved = await update(
        nodeId,
        "SET #r = :result, expectedChildren = :n, #s = :expanded",
        "attribute_exists(nodeId) AND attribute_not_exists(#r) AND NOT (#s IN (:done, :failed))",
        { ":result": result, ":n": result.children.length, ":expanded": "expanded", ...TERMINAL },
        { "#s": "status", "#r": "result" },
      );
      if (saved !== undefined) return toState(saved);
      const item = await get(nodeId);
      if (item === undefined) throw new Error(`saveResult: node ${nodeId} does not exist`);
      return toState(item);
    },

    // Rule 4: create-if-absent on deterministic ids, so re-sending children on a retry is harmless.
    async createPending(messages) {
      for (const m of messages) {
        try {
          await client.send(
            new PutCommand({
              TableName: tableName,
              Item: {
                nodeId: m.nodeId,
                runId: m.runId,
                parentId: m.parentId,
                depth: m.depth,
                status: "pending",
                attempts: 0,
                completedChildren: 0,
                failedChildren: 0,
                expiresAt: expiresAt(now()),
              },
              ConditionExpression: "attribute_not_exists(nodeId)",
            }),
          );
        } catch (error) {
          if (!isConditionalFailure(error)) throw error;
        }
      }
    },

    async finish(nodeId, status: TerminalStatus) {
      const done = await update(
        nodeId,
        "SET #s = :status",
        "attribute_exists(nodeId) AND NOT (#s IN (:done, :failed))",
        { ":status": status, ...TERMINAL },
        { "#s": "status" },
      );
      return done === undefined ? undefined : toState(done);
    },

    // Rule 5: set membership is the condition, so a duplicate completion is ignored rather than counted.
    async recordChildCompletion(parentId, childId, childStatus) {
      const counted = await update(
        parentId,
        `ADD completedChildIds :ids, completedChildren :one${childStatus === "failed" ? ", failedChildren :one" : ""}`,
        "attribute_exists(nodeId) AND NOT contains(completedChildIds, :id)",
        { ":ids": new Set([childId]), ":one": 1, ":id": childId },
        {},
      );
      return counted === undefined ? undefined : toState(counted);
    },

    // Rules 1 + 2 on the article axis, plus the A18 lease when one is given.
    async claimArticle(nodeId, lease) {
      const leaseSet = lease === undefined ? "" : ", claimedBy = :c, claimedUntil = :until";
      const leaseCondition =
        lease === undefined
          ? ""
          : " AND (attribute_not_exists(claimedUntil) OR claimedUntil < :now OR claimedBy = :c OR articleStatus <> :ip)";
      const claimed = await update(
        nodeId,
        `SET articleStatus = :ip${leaseSet}`,
        `attribute_exists(nodeId) AND (attribute_not_exists(articleStatus) OR NOT (articleStatus IN (:done, :failed)))${leaseCondition}`,
        {
          ":ip": "in_progress",
          ...TERMINAL,
          ...(lease === undefined
            ? {}
            : { ":c": lease.claimant, ":until": lease.nowMs + ARTICLE.CLAIM_LEASE_MS, ":now": lease.nowMs }),
        },
        {},
      );
      if (claimed !== undefined) return toState(claimed, await drafts.get(nodeId));
      const item = await get(nodeId);
      // An article message for a node that was never constructed is a broken enqueue, not a race.
      if (item === undefined) throw new Error(`claimArticle: node ${nodeId} does not exist`);
      const state = toState(item);
      if (state.articleStatus === "done" || state.articleStatus === "failed") return state;
      const nowMs = lease?.nowMs ?? now();
      throw new ArticleLeaseHeldError(nodeId, Math.max(0, (state.claimedUntil ?? nowMs) - nowMs));
    },

    // Rule 2, write-once, in Postgres (A14): the STORED draft is what comes back.
    async saveArticle(nodeId, article) {
      const item = await get(nodeId);
      if (item === undefined) throw new Error(`saveArticle: node ${nodeId} does not exist`);
      return toState(item, await drafts.putIfAbsent(nodeId, article));
    },

    async finishArticle(nodeId, status: TerminalStatus) {
      const done = await update(
        nodeId,
        "SET articleStatus = :status",
        "attribute_exists(nodeId) AND (attribute_not_exists(articleStatus) OR NOT (articleStatus IN (:done, :failed)))",
        { ":status": status, ...TERMINAL },
        {},
      );
      return done === undefined ? undefined : toState(done);
    },

    async markBoosted(nodeId) {
      return (await update(nodeId, "SET boosted = :t", "attribute_exists(nodeId)", { ":t": true }, {})) !== undefined;
    },

    async recordError(nodeId, reason) {
      await update(nodeId, "SET lastError = :r", "attribute_exists(nodeId)", { ":r": reason }, {});
    },

    async lastError(nodeId) {
      const out = await client.send(
        new GetCommand({ TableName: tableName, Key: { nodeId }, ProjectionExpression: "lastError", ConsistentRead: true }),
      );
      const reason = out.Item?.lastError;
      return typeof reason === "string" ? reason : undefined;
    },
  };
}

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";
import { ARTICLE } from "../../../../src/config/constants";
import { ArticleLeaseHeldError } from "../../../../src/domain/errors/article-lease-held.error";
import type { ArticleDraft } from "../../../../src/domain/schemas/article.schema";
import { createDynamoDedupStore } from "../../../../src/infrastructure/dynamodb/dynamo-dedup.store";
import { createDynamoNodeStateStore } from "../../../../src/infrastructure/dynamodb/dynamo-node-state.store";
import { createDynamoRateWindowStore } from "../../../../src/infrastructure/dynamodb/dynamo-rate-window.store";
import { createDynamoRunStateStore } from "../../../../src/infrastructure/dynamodb/dynamo-run-state.store";
import { createMemoryArticleDraftStore } from "../../../../src/infrastructure/memory/memory-article-draft.store";
import { conditionalFailure, fakeAwsClient, type SentCommand } from "../../../fixtures/fake-aws";

const tableName = "PolarisNodes";
const runId = "11111111-1111-4111-8111-111111111111";
const nodeId = "22222222-2222-4222-8222-222222222222";
const childId = "33333333-3333-4333-8333-333333333333";
const item = (extra: Record<string, unknown> = {}) => ({
  nodeId,
  runId,
  parentId: null,
  depth: 0,
  status: "in_progress",
  attempts: 1,
  completedChildren: 0,
  failedChildren: 0,
  expiresAt: 1,
  ...extra,
});
const asDoc = (client: unknown) => client as DynamoDBDocumentClient;
const values = (command: SentCommand | undefined) =>
  (command?.input.ExpressionAttributeValues ?? {}) as Record<string, unknown>;

function nodeStore(respond: (c: SentCommand, i: number) => unknown) {
  const { client, sent } = fakeAwsClient(respond);
  const drafts = createMemoryArticleDraftStore();
  return { store: createDynamoNodeStateStore({ client: asDoc(client), tableName, drafts, now: () => 1_000 }), sent, drafts };
}

describe("dynamo node state (idempotency rules 1-7, docs/aws-retrofit.md)", () => {
  it("rule 1: claim is one conditional update that never touches a terminal node", async () => {
    const { store, sent } = nodeStore(() => ({ Attributes: item() }));
    await expect(store.claim({ runId, nodeId, parentId: null, depth: 0 })).resolves.toMatchObject({ status: "in_progress" });
    expect(sent[0]?.name).toBe("UpdateCommand");
    expect(sent[0]?.input.ConditionExpression).toBe("attribute_not_exists(nodeId) OR #s IN (:pending, :ip)");
    expect(sent[0]?.input.UpdateExpression).toContain("ADD attempts :one");
  });

  it("C144: claim on an expanded node counts the attempt and KEEPS expanded", async () => {
    const { store, sent } = nodeStore((_c, i) => {
      if (i === 0) throw conditionalFailure();
      return { Attributes: item({ status: "expanded", attempts: 2 }) };
    });
    await expect(store.claim({ runId, nodeId, parentId: null, depth: 0 })).resolves.toMatchObject({ status: "expanded" });
    expect(sent[1]?.input.ConditionExpression).toBe("attribute_exists(nodeId) AND #s = :expanded");
  });

  it("a claim on a finished node returns it untouched, read consistently", async () => {
    const { store, sent } = nodeStore((c) => {
      if (c.name === "UpdateCommand") throw conditionalFailure();
      return { Item: item({ status: "done" }) };
    });
    await expect(store.claim({ runId, nodeId, parentId: null, depth: 0 })).resolves.toMatchObject({ status: "done" });
    expect(sent.at(-1)).toMatchObject({ name: "GetCommand", input: { ConsistentRead: true } });
  });

  it("rule 3: result, expectedChildren and expanded in ONE write, only without a stored result", async () => {
    const { store, sent } = nodeStore(() => ({ Attributes: item({ status: "expanded", expectedChildren: 1 }) }));
    await store.saveResult(nodeId, { brief: "b", children: [{ topic: "t", brief: "c" }] });
    expect(sent[0]?.input.UpdateExpression).toBe("SET #r = :result, expectedChildren = :n, #s = :expanded");
    expect(sent[0]?.input.ConditionExpression).toContain("attribute_not_exists(#r)");
  });

  it("rule 4: createPending is create-if-absent and a duplicate is not an error", async () => {
    const { store, sent } = nodeStore(() => {
      throw conditionalFailure();
    });
    await expect(
      store.createPending([
        {
          pass: "construct",
          runId,
          nodeId: childId,
          parentId: nodeId,
          topic: "t",
          depth: 1,
          maxDepth: 2,
          path: "n_a.n_b",
          ancestors: [],
        },
      ]),
    ).resolves.toBeUndefined();
    expect(sent[0]?.input.ConditionExpression).toBe("attribute_not_exists(nodeId)");
  });

  it("rule 5: a child completion is a set-add guarded by NOT contains; a duplicate returns undefined", async () => {
    const { store, sent } = nodeStore(() => {
      throw conditionalFailure();
    });
    await expect(store.recordChildCompletion(nodeId, childId, "failed")).resolves.toBeUndefined();
    expect(sent[0]?.input.UpdateExpression).toBe("ADD completedChildIds :ids, completedChildren :one, failedChildren :one");
    expect(sent[0]?.input.ConditionExpression).toBe("attribute_exists(nodeId) AND NOT contains(completedChildIds, :id)");
    expect(values(sent[0])[":ids"]).toEqual(new Set([childId]));
    // No names map at all: DynamoDB refuses an empty one.
    expect(sent[0]?.input.ExpressionAttributeNames).toBeUndefined();
  });

  it("reads the String Set back as the array NodeState expects", async () => {
    const { store } = nodeStore(() => ({
      Attributes: item({ status: "expanded", completedChildIds: new Set([childId]), completedChildren: 1 }),
    }));
    await expect(store.recordChildCompletion(nodeId, childId, "done")).resolves.toMatchObject({ completedChildIds: [childId] });
  });

  it("A18: an article claim with a lease is conditional on it, and a lease held by another throws", async () => {
    const { store, sent } = nodeStore((c) => {
      if (c.name === "UpdateCommand") throw conditionalFailure();
      return { Item: item({ articleStatus: "in_progress", claimedBy: "other", claimedUntil: 61_000 }) };
    });
    await expect(store.claimArticle(nodeId, { claimant: "me", nowMs: 1_000 })).rejects.toBeInstanceOf(ArticleLeaseHeldError);
    await expect(store.claimArticle(nodeId, { claimant: "me", nowMs: 1_000 })).rejects.toMatchObject({ retryAfterMs: 60_000 });
    expect(sent[0]?.input.ConditionExpression).toContain("claimedUntil < :now OR claimedBy = :c");
    expect(values(sent[0])[":until"]).toBe(1_000 + ARTICLE.CLAIM_LEASE_MS);
  });

  it("without a lease, the claim neither sets nor checks one (the local path)", async () => {
    const { store, sent } = nodeStore(() => ({ Attributes: item({ articleStatus: "in_progress" }) }));
    await store.claimArticle(nodeId);
    expect(sent[0]?.input.UpdateExpression).toBe("SET articleStatus = :ip");
    expect(String(sent[0]?.input.ConditionExpression)).not.toContain("claimedUntil");
  });

  it("A14/A23: the draft is write-once in the draft store, and comes back with the claim", async () => {
    const draft = { contentMd: "x", citations: [], credibilityVerified: false } as unknown as ArticleDraft;
    const { store, drafts } = nodeStore(() => ({ Item: item(), Attributes: item({ articleStatus: "in_progress" }) }));
    await store.saveArticle(nodeId, draft);
    await store.saveArticle(nodeId, { ...draft, contentMd: "second" });
    await expect(drafts.get(nodeId)).resolves.toMatchObject({ contentMd: "x" });
    await expect(store.claimArticle(nodeId)).resolves.toMatchObject({ article: { contentMd: "x" } });
  });

  it("A17: recordError / lastError round-trip through the node item", async () => {
    const { store, sent } = nodeStore((c) => (c.name === "GetCommand" ? { Item: { lastError: "Error: boom" } } : {}));
    await store.recordError(nodeId, "Error: boom");
    await expect(store.lastError(nodeId)).resolves.toBe("Error: boom");
    expect(sent[0]?.input.UpdateExpression).toBe("SET lastError = :r");
  });
});

describe("dynamo run state", () => {
  it("reserveNodes retries a lost race and grants from the fresh count", async () => {
    let gets = 0;
    let updates = 0;
    const { client, sent } = fakeAwsClient((c) => {
      if (c.name === "GetCommand") return { Item: { nodesCreated: (gets += 1) === 1 ? 1 : 4 } };
      if ((updates += 1) === 1) throw conditionalFailure();
      return {};
    });
    const store = createDynamoRunStateStore({ client: asDoc(client), tableName, maxNodesPerRun: 6 });
    await expect(store.reserveNodes(runId, 5)).resolves.toBe(2); // 6 - 4, after the retry
    const writes = sent.filter((s) => s.name === "UpdateCommand");
    expect(writes[1]?.input.ConditionExpression).toBe("nodesCreated = :seen");
    expect(values(writes[1])[":skipped"]).toBe(3);
  });

  it("counters are ADDs on run#<runId>, and nodesCreated starts at 1", async () => {
    const { client, sent } = fakeAwsClient(() => ({ Attributes: { nodesCreated: 1, nodesDone: 1 } }));
    const store = createDynamoRunStateStore({ client: asDoc(client), tableName });
    await expect(store.countNode(runId, "done")).resolves.toMatchObject({ runId, nodesDone: 1, nodesCreated: 1 });
    expect(sent[0]?.input.Key).toEqual({ nodeId: `run#${runId}` });
    expect(sent[0]?.input.UpdateExpression).toContain("nodesCreated = if_not_exists(nodesCreated, :one)");
  });

  it("A16: halt keeps the FIRST halt time", async () => {
    const { client, sent } = fakeAwsClient(() => ({}));
    await createDynamoRunStateStore({ client: asDoc(client), tableName }).halt(runId, 5);
    expect(sent[0]?.input.UpdateExpression).toContain("haltedAt = if_not_exists(haltedAt, :now)");
  });
});

describe("dynamo dedup + rate window", () => {
  it("rule 7: a topic another parent holds is dropped; the rest are kept in order", async () => {
    const { client, sent } = fakeAwsClient((_c, i) => {
      if (i === 1) throw conditionalFailure();
      return {};
    });
    const kept = await createDynamoDedupStore({ client: asDoc(client), tableName }).claimTopics(runId, nodeId, ["A", "B", "C"]);
    expect(kept).toEqual(["A", "C"]);
    expect(sent[0]?.input.ConditionExpression).toBe("attribute_not_exists(nodeId) OR claimantParentId = :me");
  });

  it("A13: a full minute refuses without counting and says how long until it ends", async () => {
    const { client, sent } = fakeAwsClient(() => {
      throw conditionalFailure();
    });
    const window = createDynamoRateWindowStore({ client: asDoc(client), tableName });
    await expect(window.tryAcquire("model-a", 30, 90_000)).resolves.toEqual({ ok: false, retryAfterMs: 30_000 });
    expect(sent[0]?.input.Key).toEqual({ nodeId: "rate#model-a#1" });
    expect(sent[0]?.input.ConditionExpression).toBe("attribute_not_exists(#c) OR #c < :limit");
  });

  it("any other DynamoDB error propagates", async () => {
    const { client } = fakeAwsClient(() => {
      throw new Error("ProvisionedThroughputExceededException");
    });
    await expect(createDynamoRateWindowStore({ client: asDoc(client), tableName }).tryAcquire("m", 1, 0)).rejects.toThrow(
      /Provisioned/,
    );
  });
});

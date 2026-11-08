import type { ClaimRequest, NodeResult, NodeStatePort, TerminalStatus } from "../../application/ports/node-state.port";
import { ARTICLE } from "../../config/constants";
import { ArticleLeaseHeldError } from "../../domain/errors/article-lease-held.error";
import type { ArticleDraft } from "../../domain/schemas/article.schema";
import type { NodeState } from "../../domain/schemas/node-state.schema";
import type { NodeMessage } from "../../domain/schemas/queue-message.schema";

// Atomicity contract: every method below does its read-modify-write with NO `await` between the read and
// the write, so the single-threaded event loop makes it atomic exactly as a DynamoDB conditional
// expression is. Inserting an await inside one of these blocks would silently break idempotency rule 3 or
// 5. Getters return copies, as the DynamoDB twin necessarily does.

const TERMINAL: readonly string[] = ["done", "failed"];

function copy(state: NodeState): NodeState {
  return {
    ...state,
    completedChildIds: [...state.completedChildIds],
    ...(state.result === undefined
      ? {}
      : { result: { ...state.result, children: state.result.children.map((child) => ({ ...child })) } }),
    // The stored draft is write-once, so handing out the same array would let a caller edit history.
    ...(state.article === undefined
      ? {}
      : {
          article: {
            ...state.article,
            citations: [...state.article.citations],
            ...(state.article.questions === undefined ? {} : { questions: [...state.article.questions] }),
          },
        }),
  };
}

export function createMemoryNodeStateStore(): NodeStatePort {
  const items = new Map<string, NodeState>();

  const blank = (request: ClaimRequest, status: NodeState["status"]): NodeState => ({
    nodeId: request.nodeId,
    runId: request.runId,
    parentId: request.parentId,
    depth: request.depth,
    status,
    attempts: 0,
    completedChildren: 0,
    completedChildIds: [],
    failedChildren: 0,
  });

  return {
    async claim(request) {
      const existing = items.get(request.nodeId);
      if (existing === undefined) {
        const created = { ...blank(request, "in_progress"), attempts: 1 };
        items.set(request.nodeId, created);
        return copy(created);
      }
      // Rule 1: a finished node is returned untouched, so the caller returns without doing anything.
      if (TERMINAL.includes(existing.status)) return copy(existing);
      existing.attempts += 1;
      // Never downgrade `expanded`: its result is stored and its children may already be completing against it.
      // Moving it back to in_progress made the fan-in ignore them, so the node never completed (C144).
      if (existing.status !== "expanded") existing.status = "in_progress";
      return copy(existing);
    },

    async saveResult(nodeId, result: NodeResult) {
      const state = items.get(nodeId);
      if (state === undefined) throw new Error(`saveResult: node ${nodeId} does not exist`);
      // Rule 2: an existing result is never overwritten - a retry reuses it, so two deliveries of the same
      // node can never disagree about the child set.
      if (state.result !== undefined || TERMINAL.includes(state.status)) return copy(state);
      // Rule 3: result + expectedChildren + status in one write, before any child message exists.
      state.result = {
        ...(result.topic === undefined ? {} : { topic: result.topic }),
        brief: result.brief,
        children: result.children.map((child) => ({ ...child })),
      };
      state.expectedChildren = result.children.length;
      state.status = "expanded";
      return copy(state);
    },

    async createPending(messages: readonly NodeMessage[]) {
      for (const message of messages) {
        // Rule 4: create-if-absent on a deterministic id, so re-sending children on retry is harmless.
        if (items.has(message.nodeId)) continue;
        items.set(
          message.nodeId,
          blank({ runId: message.runId, nodeId: message.nodeId, parentId: message.parentId, depth: message.depth }, "pending"),
        );
      }
    },

    async finish(nodeId, status: TerminalStatus) {
      const state = items.get(nodeId);
      if (state === undefined || TERMINAL.includes(state.status)) return undefined;
      state.status = status;
      return copy(state);
    },

    async recordChildCompletion(parentId, childId, childStatus) {
      const parent = items.get(parentId);
      if (parent === undefined) return undefined;
      // Rule 5: set membership is the condition, so a duplicate completion is ignored rather than counted.
      if (parent.completedChildIds.includes(childId)) return undefined;
      parent.completedChildIds.push(childId);
      parent.completedChildren += 1;
      if (childStatus === "failed") parent.failedChildren += 1;
      return copy(parent);
    },

    async claimArticle(nodeId, lease) {
      const state = items.get(nodeId);
      // An article message for a node that was never constructed is a broken enqueue, not a race.
      if (state === undefined) throw new Error(`claimArticle: node ${nodeId} does not exist`);
      // Rule 1 on the article axis: a finished article is returned untouched, so the caller returns.
      if (state.articleStatus !== undefined && TERMINAL.includes(state.articleStatus)) return copy(state);
      if (lease !== undefined) {
        // A18: a live lease held by ANOTHER delivery wins; the same claimant always gets its own claim back.
        const held =
          state.articleStatus === "in_progress" &&
          state.claimedBy !== undefined &&
          state.claimedBy !== lease.claimant &&
          (state.claimedUntil ?? 0) > lease.nowMs;
        if (held) throw new ArticleLeaseHeldError(nodeId, (state.claimedUntil ?? lease.nowMs) - lease.nowMs);
        state.claimedBy = lease.claimant;
        state.claimedUntil = lease.nowMs + ARTICLE.CLAIM_LEASE_MS;
      }
      state.articleStatus = "in_progress";
      return copy(state);
    },

    async recordError(nodeId, reason) {
      const state = items.get(nodeId);
      if (state !== undefined) state.lastError = reason;
    },

    async lastError(nodeId) {
      return items.get(nodeId)?.lastError;
    },

    async saveArticle(nodeId, article: ArticleDraft) {
      const state = items.get(nodeId);
      if (state === undefined) throw new Error(`saveArticle: node ${nodeId} does not exist`);
      // Rule 2: an existing draft is never overwritten - a retry reuses it, so two deliveries can never
      // store different articles or different questions.
      if (state.article !== undefined) return copy(state);
      state.article = {
        ...article,
        citations: [...article.citations],
        ...(article.questions === undefined ? {} : { questions: [...article.questions] }),
      };
      return copy(state);
    },

    async markBoosted(nodeId) {
      const state = items.get(nodeId);
      if (state === undefined) return false;
      state.boosted = true;
      return true;
    },

    async finishArticle(nodeId, status: TerminalStatus) {
      const state = items.get(nodeId);
      if (state === undefined) return undefined;
      // Exactly-once, exactly as `finish` is for construction: the undefined is what stops a second
      // delivery counting the same article again.
      if (state.articleStatus !== undefined && TERMINAL.includes(state.articleStatus)) return undefined;
      state.articleStatus = status;
      return copy(state);
    },
  };
}

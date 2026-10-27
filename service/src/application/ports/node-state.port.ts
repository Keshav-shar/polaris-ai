import type { ArticleDraft } from "../../domain/schemas/article.schema";
import type { ChildDraft } from "../../domain/schemas/node.schema";
import type { NodeState } from "../../domain/schemas/node-state.schema";
import type { NodeMessage } from "../../domain/schemas/queue-message.schema";

export type ClaimRequest = Pick<NodeMessage, "runId" | "nodeId" | "parentId" | "depth">;

// `topic` is set for the root only: the canonical topic its call named (C100).
export type NodeResult = { topic?: string; brief: string; children: readonly ChildDraft[] };

export type TerminalStatus = "done" | "failed";

// In-flight construction state. Every method is a conditional write, because SQS delivers at-least-once:
// the rules these implement are numbered 1-7 in docs/aws-retrofit.md.
export type NodeStatePort = {
  // Rule 1 + 2. Creates the item if missing, increments attempts and moves it to in_progress - UNLESS it
  // is already done or failed, in which case it is returned untouched so a duplicate delivery is a no-op.
  // An already-expanded node comes back with its stored `result`, so a retry never regenerates.
  claim(request: ClaimRequest): Promise<NodeState>;

  // Rule 3. ONE conditional write of result + expectedChildren + status "expanded", before any child
  // message exists, so a fast child cannot complete before its parent can count it.
  // Rule 2: when a result is already stored it is returned as-is rather than overwritten, so two
  // deliveries of the same node can never disagree about the child set.
  saveResult(nodeId: string, result: NodeResult): Promise<NodeState>;

  // Rule 4. Creates each child as pending only if absent (ids are deterministic), so re-sending children
  // on a retry is harmless. Final-layer children are created here too and then completed by their parent
  // without ever being claimed (C99), which is why `finish` accepts a pending node.
  createPending(messages: readonly NodeMessage[]): Promise<void>;

  // Conditional terminal transition. Resolves undefined when the node was already done/failed or is
  // missing - that `undefined` is what makes a node complete its parent exactly once.
  finish(nodeId: string, status: TerminalStatus): Promise<NodeState | undefined>;

  // Rule 5. Set-add on completedChildIds plus the counters, conditional on the child not already being
  // present. Resolves undefined for a duplicate completion or a missing parent.
  recordChildCompletion(
    parentId: string,
    childId: string,
    childStatus: TerminalStatus,
  ): Promise<NodeState | undefined>;

  // --- Article pass (Phase 10). The same two rules as construction, on the articleStatus axis. ---

  // Rule 1 + 2, for articles. Moves articleStatus to in_progress - UNLESS it is already done or failed,
  // in which case the item comes back untouched so a duplicate delivery is a no-op. An item that already
  // has a stored `article` comes back with it, so a retry never calls the writer again.
  // Throws when the node does not exist: an article message for an unconstructed node is a bug, not a
  // race, and swallowing it would hide a broken enqueue.
  claimArticle(nodeId: string): Promise<NodeState>;

  // Rule 2, for articles. Write-once: an existing draft is returned as-is rather than overwritten, so two
  // deliveries of the same node can never store different articles or different questions.
  saveArticle(nodeId: string, article: ArticleDraft): Promise<NodeState>;

  // The article twin of `finish`, and the reason it exists: resolves undefined when the article was
  // already done/failed, so a redelivery that slipped past claimArticle cannot count articlesDone twice
  // and mark the run `done` before every article is in.
  finishArticle(nodeId: string, status: TerminalStatus): Promise<NodeState | undefined>;

  // Records a learner's boost on the node, so the article message expand-node has not sent yet goes out
  // boosted (C128). Idempotent; resolves false when the node has no state yet.
  markBoosted(nodeId: string): Promise<boolean>;
};

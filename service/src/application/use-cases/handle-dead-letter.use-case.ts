import type { NodeMessage } from "../../domain/schemas/queue-message.schema";
import type { Logger } from "../../shared/logger";
import type { FanIn } from "../tree/fan-in";

export type HandleDeadLetterDeps = {
  fanIn: FanIn;
  logger: Pick<Logger, "error" | "warn">;
  // Turns the worker's error into the one readable line stored on the node and shown by the API.
  // Injected because scrubbing provider keys needs the env, which only composition may read.
  describeFailure(error: unknown): string;
};

export type HandleDeadLetter = {
  execute(message: NodeMessage, error?: unknown): Promise<void>;
};

// Last stop for a message that failed QUEUE.MAX_RECEIVES times. Marking the node failed and running the
// same fan-in cascade as the success path is what stops one flaky node hanging its whole branch: its
// ancestors still complete, and its subtree is simply never created.
export function createHandleDeadLetter({
  fanIn,
  logger,
  describeFailure,
}: HandleDeadLetterDeps): HandleDeadLetter {
  return {
    async execute(message, error) {
      const reason = error === undefined ? undefined : describeFailure(error);
      if (message.pass === "article") {
        // Same cascade as construction, on the article axis: counting the failure is what lets the run
        // still reach `done` instead of waiting forever for an article that will never be written.
        //
        // It no longer has to hand the pass down to this node's children (C89): since C91 every article
        // message comes from that node's OWN expansion, so a failed article cannot strand the subtree
        // beneath it - those nodes were enqueued by construction and are written regardless.
        logger.error("article dead-lettered", {
          runId: message.runId,
          nodeId: message.nodeId,
          topic: message.topic,
          depth: message.depth,
          // The cause, not just the fact: without it this log said a scroll was lost and nothing about
          // why, so a 429 and an unparseable draft looked identical from outside the process.
          reason,
        });
        await fanIn.completeArticle(message.runId, message.nodeId, "failed", reason);
        return;
      }
      logger.error("node dead-lettered", {
        runId: message.runId,
        nodeId: message.nodeId,
        topic: message.topic,
        depth: message.depth,
        reason,
      });
      await fanIn.completeConstruction(message.nodeId, "failed");
    },
  };
}

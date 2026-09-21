import type { NodeMessage } from "../../domain/schemas/queue-message.schema";
import type { Logger } from "../../shared/logger";
import type { FanIn } from "../tree/fan-in";

export type HandleDeadLetterDeps = { fanIn: FanIn; logger: Pick<Logger, "error" | "warn"> };

export type HandleDeadLetter = {
  execute(message: NodeMessage): Promise<void>;
};

// Last stop for a message that failed QUEUE.MAX_RECEIVES times. Marking the node failed and running the
// same fan-in cascade as the success path is what stops one flaky node hanging its whole branch: its
// ancestors still complete, and its subtree is simply never created.
export function createHandleDeadLetter({ fanIn, logger }: HandleDeadLetterDeps): HandleDeadLetter {
  return {
    async execute(message) {
      if (message.pass === "article") {
        // The article pass arrives in Phase 10; until then there is nothing to complete.
        logger.warn("article dead-letter ignored (Phase 10)", { nodeId: message.nodeId });
        return;
      }
      logger.error("node dead-lettered", {
        runId: message.runId,
        nodeId: message.nodeId,
        topic: message.topic,
        depth: message.depth,
      });
      await fanIn.completeConstruction(message.nodeId, "failed");
    },
  };
}

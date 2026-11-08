import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from "aws-lambda";
import type { NodeStatePort } from "../../application/ports/node-state.port";
import type { HandleDeadLetter } from "../../application/use-cases/handle-dead-letter.use-case";
import type { RefreshInsight } from "../../application/use-cases/refresh-insight.use-case";
import { InsightMessage } from "../../domain/schemas/insight.schema";
import { NodeMessage } from "../../domain/schemas/queue-message.schema";
import type { Logger } from "../../shared/logger";
import { parseBody } from "./sqs-handler";

// handle-dead-letter (both DLQs): a message that failed maxReceiveCount times. An SQS record carries no error, so
// the reason is the one the consumer recorded on the node before reporting its last failure (A17, C90).
export function createDeadLetterHandler(
  load: () => Promise<{ handleDeadLetter: HandleDeadLetter; nodeState: Pick<NodeStatePort, "lastError">; logger: Pick<Logger, "error"> }>,
): (event: SQSEvent) => Promise<SQSBatchResponse> {
  return async (event) => {
    const { handleDeadLetter, nodeState, logger } = await load();
    const batchItemFailures: SQSBatchItemFailure[] = [];
    for (const record of event.Records) {
      const parsed = NodeMessage.safeParse(parseBody(record.body));
      if (!parsed.success) {
        // Nothing to mark: the message never named a node. Acknowledged, so it does not cycle in the DLQ.
        logger.error("dead letter is not a node message: dropped", { messageId: record.messageId });
        continue;
      }
      try {
        const reason = await nodeState.lastError(parsed.data.nodeId);
        await handleDeadLetter.execute(parsed.data, reason);
      } catch (error) {
        logger.error("dead-letter handler failed", { nodeId: parsed.data.nodeId, error });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}

// refresh-insight (A21): the learner-insight job. Idempotent by construction, so a redelivery costs no second call.
export function createInsightHandler(
  load: () => Promise<{ refreshInsight: RefreshInsight; logger: Pick<Logger, "info" | "error"> }>,
): (event: SQSEvent) => Promise<SQSBatchResponse> {
  return async (event) => {
    const { refreshInsight, logger } = await load();
    const batchItemFailures: SQSBatchItemFailure[] = [];
    for (const record of event.Records) {
      const parsed = InsightMessage.safeParse(parseBody(record.body));
      if (!parsed.success) {
        logger.error("unusable insight message", { messageId: record.messageId });
        batchItemFailures.push({ itemIdentifier: record.messageId });
        continue;
      }
      try {
        const outcome = await refreshInsight.execute(parsed.data);
        logger.info("insight refresh", { userId: parsed.data.userId, outcome });
      } catch (error) {
        logger.error("insight refresh failed", { userId: parsed.data.userId, error });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}

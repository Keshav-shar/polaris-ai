import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import type { StallRequeuePort } from "../../application/ports/node-queue.port";
import type { NodeStatePort } from "../../application/ports/node-state.port";
import type { RunStatePort } from "../../application/ports/run-state.port";
import type { HaltRun } from "../../application/use-cases/halt-run.use-case";
import { QUEUE } from "../../config/constants";
import { ArticleLeaseHeldError } from "../../domain/errors/article-lease-held.error";
import { QuotaExhaustedError } from "../../domain/errors/quota-exhausted.error";
import { TransportUnavailableError } from "../../domain/errors/transport-unavailable.error";
import { NodeMessage } from "../../domain/schemas/queue-message.schema";
import type { Logger } from "../../shared/logger";

// Message attribute names; the SQS adapter writes the same two (sqs-node-queue.adapter.ts SQS_ATTRIBUTES).
const STALL_COUNT = "stallCount";
const CLAIMANT = "claimant";

// Who this delivery is, for the article lease (A18): stable across redeliveries and stall re-sends of ONE message.
export type Delivery = { claimant: string; nowMs: number };

// What the policy needs, structurally - so this module imports no adapter and no composition. The Lambda entry
// points fill it from the worker container.
export type SqsWorkerDeps = {
  pass: NodeMessage["pass"];
  handle(message: NodeMessage, delivery: Delivery): Promise<void>;
  runState: Pick<RunStatePort, "get">;
  nodeState: Pick<NodeStatePort, "recordError">;
  haltRun: HaltRun;
  requeueFor(message: NodeMessage): StallRequeuePort;
  describeFailure(error: unknown): string;
  logger: Pick<Logger, "warn" | "error">;
  now?: () => number;
};

// A body that is not JSON is treated like one that fails the schema: logged, then left to reach the DLQ.
export function parseBody(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function attribute(record: SQSRecord, name: string): string | undefined {
  return record.messageAttributes?.[name]?.stringValue;
}

// The one queue-consumer policy on AWS, the twin of local-queue-worker.ts (docs/aws-retrofit.md "Handler shape"):
//   halted run                       -> drop (A16): the node reads `blocked`, nothing more is spent
//   QuotaExhaustedError              -> halt the run, acknowledge (A16)
//   transport fault / lease held     -> re-send a delayed copy, acknowledge, uncounted - up to STALL_MAX_RELEASES (A15, A18)
//   anything else                    -> record the reason (A17) and report the failure: SQS redelivers, and after
//                                       maxReceiveCount the message reaches the DLQ and handle-dead-letter
// ReportBatchItemFailures must be on for the event source mapping; batch size is 1, but the loop is honest for more.
export function createSqsHandler(load: () => Promise<SqsWorkerDeps>): (event: SQSEvent) => Promise<SQSBatchResponse> {
  return async (event) => {
    const deps = await load();
    const now = deps.now ?? Date.now;
    const batchItemFailures: SQSBatchItemFailure[] = [];

    for (const record of event.Records) {
      const parsed = NodeMessage.safeParse(parseBody(record.body));
      if (!parsed.success || parsed.data.pass !== deps.pass) {
        // A malformed or misrouted message is a bug, not a transient fault: let it reach the DLQ and its alarm.
        deps.logger.error("unusable queue message", { messageId: record.messageId, expected: deps.pass });
        batchItemFailures.push({ itemIdentifier: record.messageId });
        continue;
      }
      const message = parsed.data;
      const stallCount = Number(attribute(record, STALL_COUNT) ?? 0);
      const claimant = attribute(record, CLAIMANT) ?? record.messageId;

      try {
        if ((await deps.runState.get(message.runId))?.haltedAt !== undefined) continue;
        await deps.handle(message, { claimant, nowMs: now() });
      } catch (error) {
        if (error instanceof QuotaExhaustedError) {
          deps.logger.error("run halted: LLM daily quota exhausted", { runId: message.runId, nodeId: message.nodeId, error });
          await deps.haltRun.execute(message.runId, error);
          continue;
        }
        const stall = error instanceof TransportUnavailableError || error instanceof ArticleLeaseHeldError;
        if (stall && stallCount < QUEUE.STALL_MAX_RELEASES) {
          const delayMs = error instanceof ArticleLeaseHeldError ? Math.max(error.retryAfterMs, QUEUE.STALL_DELAY_MS) : QUEUE.STALL_DELAY_MS;
          await deps.requeueFor(message).sendDelayed(message, { delayMs, stallCount: stallCount + 1, claimant });
          deps.logger.warn("stall: message re-sent with a delay", {
            nodeId: message.nodeId,
            stallCount: stallCount + 1,
            retryInMs: delayMs,
            reason: error instanceof ArticleLeaseHeldError ? "lease held" : "transport",
          });
          continue;
        }
        const reason = deps.describeFailure(error);
        deps.logger.warn("node handler failed", { nodeId: message.nodeId, pass: message.pass, stallCount, reason });
        try {
          await deps.nodeState.recordError(message.nodeId, reason);
        } catch (recordError) {
          // Losing the reason must not change the outcome: the message is still reported as failed.
          deps.logger.error("could not record the failure reason", { nodeId: message.nodeId, error: recordError });
        }
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}

import type { NodeMessage } from "../../domain/schemas/queue-message.schema";

// Producer half. Implemented in memory locally, by SQS in Phase 13.
export type NodeQueuePort = {
  send(message: NodeMessage): Promise<void>;
  // Splits internally into chunks of QUEUE.SEND_BATCH_MAX (the SendMessageBatch limit).
  sendBatch(messages: readonly NodeMessage[]): Promise<void>;
};

export type QueueReceipt = {
  receiptId: string;
  // 1 on first delivery. At QUEUE.MAX_RECEIVES the consumer dead-letters instead of redelivering.
  receiveCount: number;
  message: NodeMessage;
};

// Consumer half, separate because interfaces/workers may not import infrastructure: the local worker holds
// this port, not the concrete memory queue. In Phase 13 the SQS event source plays this role.
export type NodeQueueConsumerPort = {
  // Hides the returned messages until delete() or release(), incrementing their receiveCount.
  receive(max: number): Promise<QueueReceipt[]>;
  // Resolves on the next enqueue, or at once if a message is already visible. Lets the worker park
  // instead of polling: no timers anywhere in the drain loop.
  waitForMessage(): Promise<void>;
  delete(receiptId: string): Promise<void>;
  // Returns the message to the queue. countReceive: false rewinds the count, for a stall (an exhausted
  // daily quota) that must not push the message towards the dead-letter queue.
  release(receiptId: string, options?: { countReceive?: boolean }): Promise<void>;
  // Visible + in-flight; the worker's idle() predicate.
  size(): number;
};

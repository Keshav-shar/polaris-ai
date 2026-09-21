import { QuotaExhaustedError } from "../../src/domain/errors/quota-exhausted.error";
import type { ExpandOutput, NodeContext } from "../../src/domain/schemas/node.schema";

export type FakeExpanderOptions = {
  // Children for a topic; the default gives every non-leaf node `breadth` children named "<topic> n".
  childrenFor?(topic: string, context: NodeContext): string[];
  breadth?: number;
  delayMs?: number;
  // Topics that throw on their first N calls, to drive redelivery and dead-lettering.
  failTimes?: Record<string, number>;
  // Every call after this many throws QuotaExhaustedError: a free-tier day running out mid-build.
  quotaAfter?: number;
};

// Stands in for createExpandAgent({ generate }).expand: no network, deterministic children, and it
// records enough to prove both call reuse (per-topic counts) and the concurrency cap.
export function fakeExpander(options: FakeExpanderOptions = {}) {
  const { breadth = 2, delayMs = 0, childrenFor, failTimes = {}, quotaAfter } = options;
  const calls: string[] = [];
  const failuresLeft = new Map(Object.entries(failTimes));
  let active = 0;
  let maxObservedConcurrency = 0;

  const expand = async ({
    topic,
    context,
  }: {
    topic: string;
    context: NodeContext;
    seed?: number;
  }): Promise<ExpandOutput> => {
    calls.push(topic);
    if (quotaAfter !== undefined && calls.length > quotaAfter) {
      throw new QuotaExhaustedError("fake-model");
    }
    active += 1;
    maxObservedConcurrency = Math.max(maxObservedConcurrency, active);
    try {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const left = failuresLeft.get(topic) ?? 0;
      if (left > 0) {
        failuresLeft.set(topic, left - 1);
        throw new Error(`fake expander failure for "${topic}"`);
      }
      const children =
        context.position === "leaf"
          ? []
          : (childrenFor?.(topic, context) ??
            Array.from({ length: breadth }, (_, i) => `${topic} ${i + 1}`));
      return { brief: `brief for ${topic}`, children };
    } finally {
      active -= 1;
    }
  };

  return {
    expand,
    calls,
    countFor: (topic: string) => calls.filter((t) => t === topic).length,
    get maxObservedConcurrency() {
      return maxObservedConcurrency;
    },
  };
}

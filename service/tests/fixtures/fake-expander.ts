import { QuotaExhaustedError } from "../../src/domain/errors/quota-exhausted.error";
import type { NodeContext, RawExpansion } from "../../src/domain/schemas/node.schema";

export type FakeExpanderOptions = {
  // Children for a topic; the default gives every expanded node `breadth` children named "<topic> n". Each
  // child gets the brief "brief for <child>", written by this (parent) call as the real expander does (C99).
  childrenFor?(topic: string, context: NodeContext): string[];
  breadth?: number;
  // What the root call names the topic. Defaults to the request itself, trimmed.
  rootTopic?: string;
  delayMs?: number;
  // Topics that throw on their first N calls, to drive redelivery and dead-lettering.
  failTimes?: Record<string, number>;
  // Every call after this many throws QuotaExhaustedError: a free-tier day running out mid-build.
  quotaAfter?: number;
};

// Stands in for createExpandAgent({ generate }).expand: no network, deterministic children, and it
// records enough to prove both call reuse (per-topic counts) and the concurrency cap. A root call (one with
// `request`) also names the topic - the request itself, trimmed - and writes the root's brief (C100).
export function fakeExpander(options: FakeExpanderOptions = {}) {
  const { breadth = 2, delayMs = 0, childrenFor, failTimes = {}, quotaAfter, rootTopic } = options;
  const calls: string[] = [];
  const failuresLeft = new Map(Object.entries(failTimes));
  let active = 0;
  let maxObservedConcurrency = 0;

  const expand = async ({
    topic,
    request,
    context,
  }: {
    topic: string;
    brief?: string | undefined;
    request?: string | undefined;
    context: NodeContext;
    seed?: number | undefined;
  }): Promise<RawExpansion> => {
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
      const named = request === undefined ? topic : (rootTopic ?? request.trim());
      const children = (
        context.position === "leaf"
          ? []
          : (childrenFor?.(named, context) ?? Array.from({ length: breadth }, (_, i) => `${named} ${i + 1}`))
      ).map((child) => ({ topic: child, brief: `brief for ${child}` }));
      return request === undefined ? { children } : { topic: named, brief: `brief for ${named}`, children };
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

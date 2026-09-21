import type { ChatMessage, ChatOptions, LlmPort } from "../../application/ports/llm.port";
import { QuotaExhaustedError } from "../../domain/errors/quota-exhausted.error";
import type { Logger } from "../../shared/logger";

export type FailoverProfile = { llm: LlmPort; model: string };

// An LlmPort that reports which provider is currently answering. The expansion cache is keyed by model
// (docs/conflicts.md C49), so the key has to follow a switch or post-switch answers get filed under the
// old provider's namespace.
export type SwitchableLlm = LlmPort & { activeModel(): string };

export type FailoverDeps = {
  primary: FailoverProfile;
  fallback: FailoverProfile;
  logger: Pick<Logger, "warn">;
};

// Two free tiers, used in order. A daily quota is the ONLY thing that switches: it is the one failure no
// backoff can outlast, and the one a second provider genuinely fixes. Everything else (per-minute limits,
// 5xx, bad JSON) is already handled inside a single adapter and must not burn the second quota.
//
// The switch is STICKY and one-way. Switching back mid-run would interleave two models' answers in one
// tree, and would re-hit the quota that just failed. C49 deferred this while all state was in memory;
// with a partial tree and a `halted` run now working, failover turns a halt into a finished build.
export function createFailoverLlm({ primary, fallback, logger }: FailoverDeps): SwitchableLlm {
  let active = primary;

  return {
    activeModel: () => active.model,

    async chat(messages: readonly ChatMessage[], options?: ChatOptions): Promise<string> {
      // Read once: a concurrent call may switch underneath us, and this call should still be judged
      // against the profile it actually used.
      const used = active;
      try {
        return await used.llm.chat(messages, options);
      } catch (error) {
        if (!(error instanceof QuotaExhaustedError)) throw error;
        // Already on the fallback, or another in-flight call switched us off `used` first: either way
        // there is nothing left to fail over TO, so the quota error stands and the worker halts.
        if (used === fallback) throw error;
        if (active === used) {
          active = fallback;
          logger.warn("llm failover: daily quota exhausted, switching provider", {
            from: primary.model,
            to: fallback.model,
          });
        }
        return await fallback.llm.chat(messages, options);
      }
    },
  };
}

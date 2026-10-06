import type { ChatMessage, ChatOptions, LlmPort } from "../../application/ports/llm.port";
import { MODEL_POOL } from "../../config/constants";
import { QuotaExhaustedError } from "../../domain/errors/quota-exhausted.error";
import { TransportUnavailableError } from "../../domain/errors/transport-unavailable.error";
import { sha256Hex } from "../../shared/ids";
import type { Logger } from "../../shared/logger";
import { createLimiter } from "./concurrency";
import type { Sleep } from "./openai-compatible.adapter";
import { classifyLlmError } from "./rate-limit";
import type { SwitchableLlm } from "./switchable";

// Groq applies its rate limits per (organization, MODEL), which is what makes this worth building:
// measured on one key, spending 4,767 tokens on gpt-oss-120b moved only its own remaining-tokens
// (7,927 -> 4,608) while two other models stayed untouched. Rotating therefore multiplies real capacity
// instead of re-hitting one bucket.
//
// exhaustion - rotate only when a member is out for the DAY. Per-minute limits still back off inside the
//              member adapter, so C50 ("a burst limit backs off") holds and a tree usually stays on a
//              single model.
// throttle    - rotate on a per-minute 429 too. Models interleave within one tree and a cooled member is
//               used again. Since C93 this pool is the ONLY resilience: there is no second provider.
// round-robin - everything throttle does, and the scan STARTS at the next member each call instead of
//               always at members[0]. Under throttle the lead answers every request until it 429s, so the
//               tokens/minute of ONE model is the wall and the others idle; here the load is spread before
//               any limit is hit, so the pool's real ceiling is the sum of its members' (C92).
export type RotationPolicy = "exhaustion" | "throttle" | "round-robin";

export type PoolMember = {
  llm: LlmPort;
  model: string;
  // This model's own requests/day, or undefined when the provider publishes no ceiling. Lets the pool
  // retire a member BEFORE it 429s, which is free: no token accounting, just a request count.
  dailyRequestBudget: number | undefined;
};

export type ModelPoolDeps = {
  // Ordered: members[0] leads. Non-empty by type, so a pool can never be built with nothing to call.
  members: readonly [PoolMember, ...PoolMember[]];
  policy: RotationPolicy;
  maxConcurrency: number;
  logger: Pick<Logger, "info" | "warn">;
  sleep?: Sleep;
  now?: () => number;
};

type MemberState = {
  member: PoolMember;
  // Epoch ms; 0 = ready. Set from the server's own stated wait on a per-minute 429.
  cooldownUntil: number;
  // Daily quota hit, or its own requests/day spent. One-way: never tried again this process.
  retired: boolean;
  requests: number;
};

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createModelPoolLlm({
  members,
  policy,
  maxConcurrency,
  logger,
  sleep = defaultSleep,
  now = Date.now,
}: ModelPoolDeps): SwitchableLlm {
  const states: MemberState[] = members.map((member) => ({
    member,
    cooldownUntil: 0,
    retired: false,
    requests: 0,
  }));

  // Order-sensitive, not sorted: the order decides the lead, which decides the distribution of answers,
  // so two orderings genuinely produce different trees and must not share cached expansions. Computed
  // once, so it is stable for the process - the whole point of separating it from activeModel().
  const namespace = `pool:${sha256Hex(members.map((m) => m.model).join("\u0000")).slice(0, 16)}`;
  const label = `${members[0].model} +${members.length - 1} more`;

  // One limiter for the pool, wrapping the whole rotation loop. A single logical request is in flight on
  // at most one member at a time, so each member's own limiter can never see more than this and never
  // blocks - redundant but harmless, and it keeps LLM_MAX_CONCURRENCY meaning what it says.
  const limit = createLimiter(maxConcurrency);

  let answered = members[0].model;
  // Where the next dispatch starts scanning under round-robin. Advanced once per logical request, not per
  // attempt, so a retried call still walks the whole pool from a single starting point.
  let cursor = 0;

  function retire(state: MemberState, reason: string): void {
    if (state.retired) return;
    state.retired = true;
    const left = states.filter((s) => !s.retired).map((s) => s.member.model);
    logger.warn("llm pool: member retired for this process", {
      model: state.member.model,
      reason,
      remaining: left,
    });
  }

  // Logged at info and only on the transition, never per call: with a 60s TPM window and `throttle` a
  // per-call log would be one line per request.
  function cool(state: MemberState, ms: number): void {
    const until = now() + ms;
    if (until <= state.cooldownUntil) return;
    state.cooldownUntil = until;
    logger.info("llm pool: member throttled, rotating", { model: state.member.model, waitMs: ms });
  }

  function ready(state: MemberState): boolean {
    return !state.retired && state.cooldownUntil <= now();
  }

  async function dispatch(messages: readonly ChatMessage[], options?: ChatOptions): Promise<string> {
    let attempts = 0;
    let lastError: unknown;
    // Fixed for the whole call: the order is the same on every pass of the outer loop, so a member that
    // was cooling when it was first reached is retried in the same position once it is ready.
    const start = policy === "round-robin" ? cursor++ % states.length : 0;
    const order = start === 0 ? states : [...states.slice(start), ...states.slice(0, start)];

    for (;;) {
      for (const state of order) {
        if (!ready(state)) continue;
        // Rotation must multiply CAPACITY, never cost: without this ceiling, N members x their own retry
        // budgets would spend many times more free-tier requests per node than a single adapter does.
        if (attempts >= MODEL_POOL.MAX_ATTEMPTS) break;
        attempts += 1;
        state.requests += 1;
        try {
          const reply = await state.member.llm.chat(messages, options);
          answered = state.member.model;
          const budget = state.member.dailyRequestBudget;
          if (budget !== undefined && state.requests >= budget) {
            // Proactive, and deliberately LATE rather than early: this counter is per-process and resets
            // on restart, so it under-counts. The reactive QuotaExhaustedError path stays authoritative.
            retire(state, "daily request budget spent");
          }
          return reply;
        } catch (error) {
          lastError = error;
          // Already diagnosed by the member adapter; re-wrapping would nest the same sentence twice.
          if (error instanceof TransportUnavailableError) throw error;
          if (error instanceof QuotaExhaustedError) {
            retire(state, "daily quota");
            continue;
          }
          const classified = classifyLlmError(error);
          // The request never reached the provider, so this says nothing about THIS member: every member
          // dials the same network. Cooling them one at a time would spend the whole attempt budget to
          // learn the same thing once per model, and the caller needs to know it was a stall rather than
          // a failure, so it is raised as its own error (docs/conflicts.md C94).
          if (classified.kind === "network") throw new TransportUnavailableError(label, classified.detail);
          // A 404 is about THIS MODEL, not the pool: the key works and the request is well formed, the
          // named model simply is not there. Retire the member and carry on, because the others are fine.
          // Found live - Groq withdrew `groq/compound-mini` overnight and the pool-wide `fatal` rule below
          // failed every node of a run that had three healthy models available.
          if (classified.status === 404) {
            retire(state, "model not available to this account");
            continue;
          }
          // A bad key (401/403) or a malformed request fails identically on every member, so rotating
          // would burn the whole pool to learn the same thing once per model.
          if (classified.kind === "fatal") throw error;
          if (policy === "exhaustion" && classified.status === 429) {
            // Under this policy the member owns per-minute backoff (C50), so reaching here means it has
            // already spent its own retry budget. Rotating now would undo that contract.
            throw error;
          }
          cool(state, classified.retryAfterMs ?? MODEL_POOL.DEFAULT_COOLDOWN_MS);
          continue;
        }
      }

      // Nothing was callable this pass.
      if (states.every((s) => s.retired)) {
        // Every member is out for the day. Raised as a quota error so the worker's halt path works
        // exactly as it does for a single model - and, since C93, that halt is the end of the run.
        const earliest = states.reduce<number | undefined>((min, s) => {
          const wait = s.cooldownUntil - now();
          return wait > 0 && (min === undefined || wait < min) ? wait : min;
        }, undefined);
        throw new QuotaExhaustedError(label, earliest);
      }
      if (attempts >= MODEL_POOL.MAX_ATTEMPTS) {
        // Members are merely cooling, so this is a per-minute condition that clears by itself. Rethrowing
        // raw keeps QuotaExhaustedError meaning "the DAY is gone" - the contract the worker relies on to
        // halt a run permanently rather than retry it.
        throw lastError ?? new Error("model pool exhausted without attempting a call");
      }
      const wait = states
        .filter((s) => !s.retired)
        .reduce((min, s) => Math.min(min, s.cooldownUntil - now()), Number.POSITIVE_INFINITY);
      await sleep(Math.max(0, wait));
    }
  }

  return {
    chat: (messages: readonly ChatMessage[], options?: ChatOptions) =>
      limit(() => dispatch(messages, options)),
    activeModel: () => answered,
    cacheNamespace: () => namespace,
  };
}

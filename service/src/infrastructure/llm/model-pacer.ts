import type { RateWindowDecision, RateWindowPort } from "../../application/ports/rate-window.port";
import type { RateHeaders } from "./rate-limit";

// Proactive pacing for ONE model (C130). Groq limits each (organization, model) pair, and the expand and writer
// pools can name the same model, so composition builds exactly one pacer per model id and hands it to every
// member that calls that model. Two signals, both checked before a request is sent:
//
//   requests/minute - a shared RateWindowPort counter. The limit starts at MODEL_POOL.DEFAULT_RPM and moves to
//                     whatever a 429 body states, since Groq publishes it nowhere else.
//   tokens/minute   - the last `x-ratelimit-*-tokens` snapshot, refilled linearly towards the bucket size.
//
// Neither is authoritative: a 429 from the provider still decides. Pacing only stops a request that is plainly
// going to be refused from spending the request at all.
export type ModelPacer = {
  // Reserves one request for this model, or says how long until one would fit. Counts nothing on refusal.
  admit(estimatedTokens: number): Promise<RateWindowDecision>;
  observeHeaders(headers: RateHeaders): void;
  observeRequestsPerMinute(limit: number): void;
};

export type ModelPacerDeps = {
  model: string;
  window: RateWindowPort;
  requestsPerMinute: number;
  now: () => number;
};

export function createModelPacer({ model, window, requestsPerMinute, now }: ModelPacerDeps): ModelPacer {
  let rpm = requestsPerMinute;
  // `perMs` is the refill rate implied by the snapshot, fixed when it is taken so a local deduction cannot change it.
  let snapshot: (RateHeaders & { at: number; perMs: number | undefined }) | undefined;

  // Tokens believed available at `t`, and how long until `need` would be.
  const tokenWait = (need: number, t: number): number => {
    if (snapshot === undefined) return 0;
    const { remainingTokens, resetTokensMs, limitTokens, at, perMs } = snapshot;
    const elapsed = t - at;
    if (elapsed >= resetTokensMs) return 0;
    // A request larger than the whole bucket can never fit; let the provider answer it rather than wait forever.
    if (limitTokens !== undefined && need > limitTokens) return 0;
    if (limitTokens === undefined || perMs === undefined) {
      return need <= remainingTokens ? 0 : resetTokensMs - elapsed;
    }
    const available = Math.min(limitTokens, remainingTokens + elapsed * perMs);
    if (need <= available) return 0;
    return perMs > 0 ? Math.ceil((need - available) / perMs) : resetTokensMs - elapsed;
  };

  return {
    async admit(estimatedTokens) {
      const t = now();
      const wait = tokenWait(estimatedTokens, t);
      if (wait > 0) return { ok: false, retryAfterMs: wait };
      const decision = await window.tryAcquire(model, rpm, t);
      if (!decision.ok) return decision;
      // Taken out of the snapshot at once, so concurrent callers do not all spend the same headroom. The next
      // response's headers replace this guess with the provider's own figure.
      if (snapshot !== undefined && t - snapshot.at < snapshot.resetTokensMs) {
        snapshot = { ...snapshot, remainingTokens: Math.max(0, snapshot.remainingTokens - estimatedTokens) };
      }
      return { ok: true };
    },

    observeHeaders(headers) {
      const { remainingTokens, resetTokensMs, limitTokens } = headers;
      snapshot = {
        ...headers,
        at: now(),
        perMs: limitTokens === undefined || resetTokensMs <= 0 ? undefined : (limitTokens - remainingTokens) / resetTokensMs,
      };
    },

    observeRequestsPerMinute(limit) {
      if (Number.isInteger(limit) && limit > 0) rpm = limit;
    },
  };
}

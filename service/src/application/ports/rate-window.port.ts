export type RateWindowDecision = { ok: true } | { ok: false; retryAfterMs: number };

// A shared requests-per-minute counter, one window per key (`<model>`), checked BEFORE a provider request so
// a request that would be refused is never sent (amendment A13, docs/aws-retrofit.md). Fixed epoch-minute
// windows: the shape a DynamoDB conditional `ADD count :1` on `rate#<model>#<epochMinute>` gives in Phase 13,
// where warm Lambda containers share nothing else. In memory until then.
export type RateWindowPort = {
  // Counts one request against `key` if fewer than `limit` were counted in the minute containing `nowMs`;
  // otherwise counts nothing and says how long until that minute ends.
  tryAcquire(key: string, limit: number, nowMs: number): Promise<RateWindowDecision>;
};

// Per-user daily counters for the cost guards (C105): Postgres `usage_daily` through the `reserve_user_run`
// RPC, in memory for tests.
export type UsagePort = {
  // Counts one run against today's (UTC) total and answers whether it fitted under `limit`. Atomic: two
  // requests racing for the last slot cannot both get it. A refused reservation counts nothing.
  reserveRun(userId: string, limit: number): Promise<boolean>;
  // The same, for learner-insight refreshes (INSIGHT.MAX_PER_USER_PER_DAY, C139): `reserve_user_insight`.
  reserveInsight(userId: string, limit: number): Promise<boolean>;
};

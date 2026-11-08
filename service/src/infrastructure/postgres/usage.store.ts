import { z } from "zod";
import type { UsagePort } from "../../application/ports/usage.port";
import { check } from "./postgres-error";
import type { Db } from "./supabase.client";

// usage_daily through reserve_user_run: increment-and-check in one statement, so two requests racing for the
// last slot cannot both get it (C105).
export function createPostgresUsageStore(db: Db): UsagePort {
  return {
    async reserveRun(userId, limit) {
      const result = await db.rpc("reserve_user_run", { p_user_id: userId, p_limit: limit });
      check("usage.reserveRun", result);
      // The new count, or -1 when the caller was already at the limit.
      return z.number().int().parse(result.data) >= 0;
    },

    async reserveInsight(userId, limit) {
      const result = await db.rpc("reserve_user_insight", { p_user_id: userId, p_limit: limit });
      check("usage.reserveInsight", result);
      return z.number().int().parse(result.data) >= 0;
    },
  };
}

import { z } from "zod";
import type { RunRepositoryPort } from "../../application/ports/run-repository.port";
import { PROMPT_VERSION } from "../../config/constants";
import { type Run, RunStats, RunStatus, RunVisibility } from "../../domain/schemas/run.schema";
import { check } from "./postgres-error";
import type { Db } from "./supabase.client";

// `request` is deliberately NOT read back: it is the learner's raw prompt, kept for the owner, and no read path
// returns it (C105). Selecting it would only put it in more memory.
const COLUMNS = "id, owner_id, visibility, topic, max_depth, status, halt_reason, stats";

// DB JSON is a trust boundary like any other: a row that fails this is a bug or tampering, never coerced.
const RunRow = z.object({
  id: z.uuid(),
  owner_id: z.uuid(),
  visibility: RunVisibility,
  topic: z.string(),
  max_depth: z.number().int(),
  status: RunStatus,
  halt_reason: z.string().nullable(),
  stats: RunStats.nullable(),
});

function toRun(raw: unknown): Run {
  const row = RunRow.parse(raw);
  return {
    runId: row.id,
    topic: row.topic,
    maxDepth: row.max_depth,
    status: row.status,
    ownerId: row.owner_id,
    visibility: row.visibility,
    ...(row.halt_reason === null ? {} : { haltReason: row.halt_reason }),
    ...(row.stats === null ? {} : { stats: row.stats }),
  };
}

export function createPostgresRunRepository(db: Db): RunRepositoryPort {
  const runs = () => db.from("runs");

  const listWhere = async (
    operation: string,
    filter: (query: ReturnType<ReturnType<typeof runs>["select"]>) => ReturnType<ReturnType<typeof runs>["select"]>,
    limit: number,
  ): Promise<Run[]> => {
    const result = await filter(runs().select(COLUMNS))
      .order("created_at", { ascending: false })
      .limit(Math.max(1, limit));
    check(operation, result);
    return (result.data ?? []).map(toRun);
  };

  return {
    async create(run) {
      if (run.ownerId === undefined) {
        // Postgres mode is auth mode: an ownerless run here is a wiring bug, refused loudly (C137).
        throw new Error("postgres runs.create: a run stored in Postgres must have an owner");
      }
      check(
        "runs.create",
        await runs().insert({
          id: run.runId,
          owner_id: run.ownerId,
          visibility: run.visibility ?? "private",
          topic: run.topic,
          request: run.request ?? "",
          max_depth: run.maxDepth,
          status: run.status,
          halt_reason: run.haltReason ?? null,
          prompt_version: PROMPT_VERSION,
        }),
      );
    },

    async countActive() {
      // One indexed count over the partial index on status = 'constructing' (C61). NOT a `head` request: a HEAD
      // response has no body, so a missing table came back as `count: null, error: null` and read as zero active
      // runs - which hid an unmigrated database until a later call failed with a bare 500 (found live 2026-11-01).
      // range(0, 0) transfers at most one id and keeps the error.
      const result = await runs().select("id", { count: "exact" }).eq("status", "constructing").range(0, 0);
      check("runs.countActive", result);
      return result.count ?? 0;
    },

    async setStatus(runId, status, haltReason) {
      check(
        "runs.setStatus",
        await runs()
          .update(haltReason === undefined ? { status } : { status, halt_reason: haltReason })
          .eq("id", runId),
      );
    },

    async setTopic(runId, topic) {
      check("runs.setTopic", await runs().update({ topic }).eq("id", runId));
    },

    async setVisibility(runId, visibility) {
      check("runs.setVisibility", await runs().update({ visibility }).eq("id", runId));
    },

    async setStats(runId, stats) {
      check("runs.setStats", await runs().update({ stats }).eq("id", runId));
    },

    async get(runId) {
      const result = await runs().select(COLUMNS).eq("id", runId).maybeSingle();
      check("runs.get", result);
      return result.data === null ? undefined : toRun(result.data);
    },

    list: (limit) => listWhere("runs.list", (q) => q, limit),
    listByOwner: (ownerId, limit) => listWhere("runs.listByOwner", (q) => q.eq("owner_id", ownerId), limit),
    listPublic: (limit) => listWhere("runs.listPublic", (q) => q.eq("visibility", "public"), limit),

    async pruneForOwner(ownerId, keep) {
      const result = await db.rpc("prune_user_runs", { p_owner_id: ownerId, p_keep: keep });
      check("runs.pruneForOwner", result);
      return z.number().int().parse(result.data);
    },

    async haltInterrupted(reason) {
      const result = await db.rpc("halt_interrupted_runs", { p_reason: reason });
      check("runs.haltInterrupted", result);
      return z.number().int().parse(result.data);
    },
  };
}

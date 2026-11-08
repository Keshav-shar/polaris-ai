import { UnauthenticatedError } from "../../domain/errors/unauthenticated.error";
import type { RunsResponse } from "../../domain/schemas/api.schema";
import type { Caller } from "../../domain/schemas/caller.schema";
import type { Run } from "../../domain/schemas/run.schema";
import type { RunRepositoryPort } from "../ports/run-repository.port";

export type ListRunsScope = "mine" | "public";

export type ListRuns = {
  execute(limit: number, query?: { scope?: ListRunsScope; caller?: Caller | undefined }): Promise<RunsResponse>;
};

// Read-only and LLM-free: the library needs to know which runs exist before it can fetch their trees.
// Deliberately returns the run record only, not node counts - those live in the tree read model, and
// fetching every tree here would turn one page load into an unbounded read. Never returns `request`: a
// summary may be someone else's run (C105).
//
// authRequired (Supabase configured): `mine` = the caller's own runs and needs a caller; `public` = runs their
// owners listed. Auth off: every run is ownerless and `mine` lists them all, as before Phase 12.
export function createListRuns({ runs, authRequired = false }: { runs: RunRepositoryPort; authRequired?: boolean }): ListRuns {
  const summarize = (run: Run): RunsResponse["runs"][number] => ({
    runId: run.runId,
    topic: run.topic,
    maxDepth: run.maxDepth,
    status: run.status,
    ...(run.haltReason === undefined ? {} : { haltReason: run.haltReason }),
    ...(run.ownerId === undefined ? {} : { visibility: run.visibility ?? "private" }),
  });

  return {
    async execute(limit, { scope = "mine", caller } = {}) {
      if (scope === "public") return { runs: (await runs.listPublic(limit)).map(summarize) };
      if (!authRequired) return { runs: (await runs.list(limit)).map(summarize) };
      if (caller === undefined) throw new UnauthenticatedError("Sign in to see your library.");
      return { runs: (await runs.listByOwner(caller.userId, limit)).map(summarize) };
    },
  };
}

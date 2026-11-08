import type { RunRepositoryPort } from "../../application/ports/run-repository.port";
import type { Run, RunStats, RunStatus, RunVisibility } from "../../domain/schemas/run.schema";

const FINISHED: ReadonlySet<RunStatus> = new Set(["done", "failed", "halted"]);

export function createMemoryRunRepository(): RunRepositoryPort {
  // A Map iterates in insertion order, which IS creation order here: every "newest first" below is a reverse.
  const runs = new Map<string, Run>();

  // Copies, never the stored objects, so a caller cannot mutate the repository through what it reads.
  const newestFirst = (keep: (run: Run) => boolean, limit: number): Run[] =>
    [...runs.values()]
      .reverse()
      .filter(keep)
      .slice(0, Math.max(0, limit))
      .map((run) => ({ ...run }));

  return {
    async create(run: Run) {
      runs.set(run.runId, { ...run });
    },
    async setStatus(runId: string, status: RunStatus, haltReason?: string) {
      const run = runs.get(runId);
      if (run === undefined) return;
      run.status = status;
      if (haltReason !== undefined) run.haltReason = haltReason;
    },
    async setTopic(runId: string, topic: string) {
      const run = runs.get(runId);
      if (run !== undefined) run.topic = topic;
    },
    async setVisibility(runId: string, visibility: RunVisibility) {
      const run = runs.get(runId);
      if (run !== undefined) run.visibility = visibility;
    },
    async setStats(runId: string, stats: RunStats) {
      const run = runs.get(runId);
      if (run !== undefined) run.stats = { ...stats };
    },
    async countActive() {
      let active = 0;
      for (const run of runs.values()) if (run.status === "constructing") active += 1;
      return active;
    },
    async get(runId: string) {
      const run = runs.get(runId);
      return run === undefined ? undefined : { ...run };
    },
    async list(limit: number) {
      return newestFirst(() => true, limit);
    },
    async listByOwner(ownerId: string, limit: number) {
      return newestFirst((run) => run.ownerId === ownerId, limit);
    },
    async listPublic(limit: number) {
      return newestFirst((run) => run.visibility === "public", limit);
    },
    async pruneForOwner(ownerId: string, keep: number) {
      const stale = [...runs.values()]
        .reverse()
        .filter((run) => run.ownerId === ownerId && run.visibility === "private" && FINISHED.has(run.status))
        .slice(Math.max(0, keep));
      for (const run of stale) runs.delete(run.runId);
      return stale.length;
    },
    async haltInterrupted(reason: string) {
      let halted = 0;
      for (const run of runs.values()) {
        if (run.status !== "constructing" && run.status !== "constructed") continue;
        run.status = "halted";
        run.haltReason = reason;
        halted += 1;
      }
      return halted;
    },
  };
}

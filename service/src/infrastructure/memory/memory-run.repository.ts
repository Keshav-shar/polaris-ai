import type { RunRepositoryPort } from "../../application/ports/run-repository.port";
import type { Run, RunStatus } from "../../domain/schemas/run.schema";

export function createMemoryRunRepository(): RunRepositoryPort {
  const runs = new Map<string, Run>();

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
    async countActive() {
      let active = 0;
      for (const run of runs.values()) if (run.status === "constructing") active += 1;
      return active;
    },
    async get(runId: string) {
      const run = runs.get(runId);
      return run === undefined ? undefined : { ...run };
    },
  };
}

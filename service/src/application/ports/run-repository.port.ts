import type { Run, RunStatus } from "../../domain/schemas/run.schema";

// The durable run record. Never kept in the expiring node-state store (service/README.md, defect 2).
export type RunRepositoryPort = {
  create(run: Run): Promise<void>;
  // Runs still `constructing`. Read by the start use-case's cost guard, so it must count what is really
  // building, not what a caller remembers starting: in Phase 12 one indexed `count(*)` (docs/conflicts.md C61).
  countActive(): Promise<number>;
  setStatus(runId: string, status: RunStatus, haltReason?: string): Promise<void>;
  get(runId: string): Promise<Run | undefined>;
};

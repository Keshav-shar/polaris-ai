import type { Run, RunStatus } from "../../domain/schemas/run.schema";

// The durable run record. Never kept in the expiring node-state store (service/README.md, defect 2).
export type RunRepositoryPort = {
  create(run: Run): Promise<void>;
  // Runs still `constructing`. Read by the start use-case's cost guard, so it must count what is really
  // building, not what a caller remembers starting: in Phase 12 one indexed `count(*)` (docs/conflicts.md C61).
  countActive(): Promise<number>;
  setStatus(runId: string, status: RunStatus, haltReason?: string): Promise<void>;
  // The canonical topic the root call named (C100). A run is created under a provisional topic cut from the
  // learner's request, because kickoff makes no LLM call; idempotent, so a redelivered root may repeat it.
  setTopic(runId: string, topic: string): Promise<void>;
  get(runId: string): Promise<Run | undefined>;
  // Recent runs, newest first, for the UI's Codex. In Phase 12 this is one indexed `order by created_at
  // desc limit $1`; in memory it is insertion order reversed, which is the same thing for a single
  // process. Bounded by `limit` so a long-lived process cannot return an unbounded list.
  list(limit: number): Promise<Run[]>;
};

import type { Run, RunStats, RunStatus, RunVisibility } from "../../domain/schemas/run.schema";

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
  // The caller's own runs, newest first (C105). Postgres: index (owner_id, created_at desc).
  listByOwner(ownerId: string, limit: number): Promise<Run[]>;
  // Runs whose owners listed them for everyone, newest first. Postgres: partial index on visibility = 'public'.
  listPublic(limit: number): Promise<Run[]>;
  setVisibility(runId: string, visibility: RunVisibility): Promise<void>;
  // The run-state counters, copied onto the durable record at a terminal transition (C107).
  setStats(runId: string, stats: RunStats): Promise<void>;
  // MAX_STORED_RUNS_PER_USER: deletes the owner's oldest PRIVATE, finished runs beyond `keep` (and everything
  // under them). A run still building, or one shared with others, is never pruned. Returns how many went.
  pruneForOwner(ownerId: string, keep: number): Promise<number>;
  // QUEUE_MODE=memory with a permanent store: the queues die with the process, so a run that was building when
  // it stopped can never finish. Marks every `constructing`/`constructed` run halted; returns how many.
  haltInterrupted(reason: string): Promise<number>;
};

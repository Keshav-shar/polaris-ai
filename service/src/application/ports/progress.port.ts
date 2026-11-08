import type { NodeProgress, RunProgress } from "../../domain/schemas/progress.schema";
import type { ProgressSignal } from "../../domain/entities/learner-signals";

export type ProgressKey = { userId: string; nodeId: string; runId: string };

// One learner's read state and quiz results per node: Postgres `node_progress` (C106), in memory for tests.
// Every write is an upsert keyed by (user, node), so a repeated request changes nothing it should not.
export type ProgressPort = {
  // Sets read_at the FIRST time only; reading a lesson again does not move it.
  markRead(key: ProgressKey): Promise<void>;
  // Atomic: attempts + 1 and best = max(best, correct) in one statement, so two tabs submitting at once cannot
  // lose an attempt or lower the best score.
  recordQuizAttempt(key: ProgressKey, correct: number, answers: readonly number[]): Promise<NodeProgress>;
  get(userId: string, nodeId: string): Promise<NodeProgress | undefined>;
  // The learner's rows for one run, for the map's read/mastery markers. One indexed query (user_id, run_id).
  listForRun(userId: string, runId: string): Promise<RunProgress>;
  // The learner's newest rows across every run, newest first, at most `limit`: the insight job's input.
  listRecent(userId: string, limit: number): Promise<ProgressSignal[]>;
};

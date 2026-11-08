import { z } from "zod";
import type { ProgressPort } from "../../application/ports/progress.port";
import type { NodeProgress, RunProgress } from "../../domain/schemas/progress.schema";
import { check } from "./postgres-error";
import type { Db } from "./supabase.client";

const ProgressRow = z.object({
  read_at: z.string().nullable(),
  quiz_attempts: z.number().int().min(0),
  quiz_best: z.number().int().min(0).nullable(),
});

const ListedRow = ProgressRow.extend({ node_id: z.uuid(), updated_at: z.string() });

function toProgress(raw: unknown): NodeProgress {
  const row = ProgressRow.parse(raw);
  return {
    read: row.read_at !== null,
    quizAttempts: row.quiz_attempts,
    ...(row.quiz_best === null ? {} : { quizBest: row.quiz_best }),
  };
}

// node_progress (0008) through mark_node_read / record_quiz_attempt (0015) for the writes that must be atomic, and
// plain selects for the reads. Every read is scoped to one user id: the service-role key bypasses RLS, so the
// filter here IS the access rule (C107).
export function createPostgresProgressRepository(db: Db): ProgressPort {
  return {
    async markRead({ userId, nodeId, runId }) {
      check(
        "progress.markRead",
        await db.rpc("mark_node_read", { p_user_id: userId, p_node_id: nodeId, p_run_id: runId }),
      );
    },

    async recordQuizAttempt({ userId, nodeId, runId }, correct, answers) {
      const result = await db.rpc("record_quiz_attempt", {
        p_user_id: userId,
        p_node_id: nodeId,
        p_run_id: runId,
        p_correct: correct,
        p_answers: answers,
      });
      check("progress.recordQuizAttempt", result);
      const rows = z.array(z.unknown()).min(1).parse(result.data);
      return toProgress(rows[0]);
    },

    async get(userId, nodeId) {
      const result = await db
        .from("node_progress")
        .select("read_at, quiz_attempts, quiz_best")
        .eq("user_id", userId)
        .eq("node_id", nodeId)
        .maybeSingle();
      check("progress.get", result);
      return result.data === null ? undefined : toProgress(result.data);
    },

    async listForRun(userId, runId) {
      const result = await db
        .from("node_progress")
        .select("node_id, read_at, quiz_attempts, quiz_best, updated_at")
        .eq("user_id", userId)
        .eq("run_id", runId);
      check("progress.listForRun", result);
      const out: RunProgress = {};
      for (const raw of result.data ?? []) {
        const row = ListedRow.parse(raw);
        out[row.node_id] = toProgress(row);
      }
      return out;
    },

    async listRecent(userId, limit) {
      const result = await db
        .from("node_progress")
        .select("node_id, read_at, quiz_attempts, quiz_best, updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(Math.max(1, limit));
      check("progress.listRecent", result);
      return (result.data ?? []).map((raw) => {
        const row = ListedRow.parse(raw);
        return { ...toProgress(row), updatedAt: row.updated_at };
      });
    },
  };
}

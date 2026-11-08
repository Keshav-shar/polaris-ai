import { z } from "zod";
import type { FeedbackPort } from "../../application/ports/feedback.port";
import { FeedbackTag, type LessonFeedback, LessonFeedbackBody } from "../../domain/schemas/feedback.schema";
import { check } from "./postgres-error";
import type { Db } from "./supabase.client";

const FeedbackRow = z.object({
  helpful: z.boolean().nullable(),
  tags: z.array(FeedbackTag),
  updated_at: z.string(),
});

function toFeedback(raw: unknown): LessonFeedback {
  const row = FeedbackRow.parse(raw);
  return { helpful: row.helpful, tags: row.tags, updatedAt: row.updated_at };
}

// lesson_feedback (0013): one row per (user, node), replaced on every save. Reads are scoped to one user id - with
// the service-role key the filter is the access rule.
export function createPostgresFeedbackRepository(db: Db): FeedbackPort {
  return {
    async upsert({ userId, nodeId, runId }, feedback) {
      // Re-validated here too: the closed vocabulary is the whole point of the table (C138).
      const { helpful, tags } = LessonFeedbackBody.parse(feedback);
      const result = await db
        .from("lesson_feedback")
        .upsert(
          { user_id: userId, node_id: nodeId, run_id: runId, helpful, tags, updated_at: new Date().toISOString() },
          { onConflict: "user_id,node_id" },
        )
        .select("helpful, tags, updated_at")
        .single();
      check("feedback.upsert", result);
      return toFeedback(result.data);
    },

    async get(userId, nodeId) {
      const result = await db
        .from("lesson_feedback")
        .select("helpful, tags, updated_at")
        .eq("user_id", userId)
        .eq("node_id", nodeId)
        .maybeSingle();
      check("feedback.get", result);
      return result.data === null ? undefined : toFeedback(result.data);
    },

    async listRecent(userId, limit) {
      const result = await db
        .from("lesson_feedback")
        .select("helpful, tags, updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(Math.max(1, limit));
      check("feedback.listRecent", result);
      return (result.data ?? []).map(toFeedback);
    },
  };
}

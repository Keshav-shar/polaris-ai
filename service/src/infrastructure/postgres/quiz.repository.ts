import { z } from "zod";
import type { QuizStorePort } from "../../application/ports/quiz-store.port";
import { QuizOutput } from "../../domain/schemas/quiz.schema";
import { check } from "./postgres-error";
import type { Db } from "./supabase.client";

// At most one quiz per node; `questions` validated with QuizOutput on the way in AND out, so a stored set always
// has QUIZ_CONFIG's shape (C74, C80).
export function createPostgresQuizStore(db: Db): QuizStorePort {
  return {
    async upsert(quiz) {
      const { questions } = QuizOutput.parse({ questions: quiz.questions });
      check(
        "quizzes.upsert",
        await db
          .from("quizzes")
          .upsert(
            { node_id: quiz.nodeId, questions, generated_at: new Date().toISOString() },
            { onConflict: "node_id" },
          ),
      );
    },

    async get(nodeId) {
      const result = await db.from("quizzes").select("questions").eq("node_id", nodeId).maybeSingle();
      check("quizzes.get", result);
      if (result.data === null) return undefined;
      const row = z.object({ questions: z.unknown() }).parse(result.data);
      return { nodeId, ...QuizOutput.parse({ questions: row.questions }) };
    },
  };
}

import { dbFailure, isSchemaMissing } from "./postgres-error";
import type { Db } from "./supabase.client";

// Every table the service reads or writes, plus each column a LATER migration added to an existing table - that is
// how a half-applied schema shows: the table is there, the column is not. Keep in step with
// service/supabase/migrations/.
const EXPECTED: readonly { table: string; column?: string; migration: string }[] = [
  { table: "profiles", migration: "0002" },
  { table: "runs", migration: "0003" },
  { table: "nodes", migration: "0004" },
  { table: "evidence", migration: "0005" },
  { table: "articles", migration: "0006" },
  { table: "quizzes", migration: "0007" },
  { table: "node_progress", migration: "0008" },
  { table: "usage_daily", migration: "0009" },
  { table: "expansion_cache", migration: "0010" },
  { table: "lesson_feedback", migration: "0013" },
  { table: "learner_insights", migration: "0014" },
  { table: "usage_daily", column: "insights_generated", migration: "0015" },
  { table: "article_drafts", migration: "0016" },
  { table: "evidence", column: "provider", migration: "0017" },
];

// What is missing, as "<table>[.<column>] (<migration>)" strings; [] when the schema is complete. One `limit 0`
// select per entry, so no row is read. Anything other than "not there" (an outage, a bad key) is thrown as the
// usual dbFailure, so a startup probe never mistakes an unreachable database for a missing schema.
export async function probeSchema(db: Db): Promise<string[]> {
  const missing: string[] = [];
  for (const { table, column, migration } of EXPECTED) {
    const result = await db.from(table).select(column ?? "*").limit(0);
    if (result.error === null) continue;
    if (!isSchemaMissing(result.error.code)) throw dbFailure(`schema probe ${table}`, result.error);
    missing.push(`${table}${column === undefined ? "" : `.${column}`} (${migration})`);
  }
  return missing;
}

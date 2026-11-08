import { DependencyUnavailableError } from "../../domain/errors/dependency-unavailable.error";
import { StorageNotReadyError } from "../../domain/errors/storage-not-ready.error";

// "The schema is not there": PostgREST cannot find the table / function / column (PGRST205 / PGRST202 / PGRST204),
// or Postgres itself reports an undefined table / function / column (42P01 / 42883 / 42703 - the last is what a
// select of a column a later migration adds returns, seen live 2026-11-07, C143). All mean the migrations were not
// applied.
const SCHEMA_MISSING = new Set(["PGRST205", "PGRST202", "PGRST204", "42P01", "42883", "42703"]);

export function isSchemaMissing(code: string | undefined): boolean {
  return SCHEMA_MISSING.has(code ?? "");
}

// The error half of every supabase-js result. `code` is a Postgres SQLSTATE or a PostgREST code; it is empty when
// the HTTP request itself failed.
type DbError = { message: string; code?: string | undefined };

// Turns a failed result into a thrown error. A request that never completed is DependencyUnavailableError (503,
// retryable); anything Postgres refused is a plain Error naming the operation and the code. Neither carries row
// values: Postgres puts those in `details`, which is deliberately left out so they never reach a log line, a
// stored failure reason or a client.
export function dbFailure(operation: string, error: DbError): Error {
  const code = error.code ?? "";
  if (SCHEMA_MISSING.has(code)) return new StorageNotReadyError(operation, `${code}: ${error.message}`);
  if (code === "" || /fetch failed|network|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(error.message)) {
    return new DependencyUnavailableError("database", operation, error.message);
  }
  return new Error(`postgres ${operation} failed (${code}): ${error.message}`);
}

// For the many calls whose only outcome of interest is "it worked".
export function check(operation: string, result: { error: DbError | null }): void {
  if (result.error !== null) throw dbFailure(operation, result.error);
}

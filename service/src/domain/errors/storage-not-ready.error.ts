import { DomainError } from "./domain-error";

// The database answered, but the schema Polaris needs is not there: a table or RPC is missing because the
// migrations in service/supabase/migrations/ were never applied (or only partly). An operator problem, not a
// request problem and not an outage, so it gets its own 503 code and a log line naming the fix; `detail` (the
// PostgREST text) stays in the log.
export class StorageNotReadyError extends DomainError {
  readonly code = "STORAGE_NOT_READY";

  constructor(
    readonly operation: string,
    readonly detail: string,
  ) {
    super(`The database is missing Polaris's tables (${operation}). Apply the migrations: npm --prefix service run db:push.`);
  }
}

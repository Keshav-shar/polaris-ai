import { describe, expect, it } from "vitest";
import { DependencyUnavailableError } from "../../../../src/domain/errors/dependency-unavailable.error";
import { StorageNotReadyError } from "../../../../src/domain/errors/storage-not-ready.error";
import { check, dbFailure } from "../../../../src/infrastructure/postgres/postgres-error";

describe("dbFailure", () => {
  it("reads a request that never completed as the database being unavailable", () => {
    expect(dbFailure("runs.get", { message: "TypeError: fetch failed", code: "" })).toBeInstanceOf(
      DependencyUnavailableError,
    );
  });

  it("names the operation and the code of anything Postgres refused, without row values", () => {
    const error = dbFailure("runs.create", { message: "duplicate key value violates unique constraint", code: "23505" });
    expect(error).not.toBeInstanceOf(DependencyUnavailableError);
    expect(error.message).toBe("postgres runs.create failed (23505): duplicate key value violates unique constraint");
  });

  it("reads a missing table or function as an unmigrated database, not a 500 (found live 2026-11-01)", () => {
    for (const code of ["PGRST205", "PGRST202", "42P01", "42883"]) {
      expect(dbFailure("runs.get", { message: "Could not find the table", code })).toBeInstanceOf(StorageNotReadyError);
    }
  });

  it("passes a successful result through", () => {
    expect(() => check("x", { error: null })).not.toThrow();
  });
});

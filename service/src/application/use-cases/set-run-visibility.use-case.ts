import { isRunOwner } from "../../domain/entities/run-access";
import { RunNotFoundError } from "../../domain/errors/run-not-found.error";
import { UnauthenticatedError } from "../../domain/errors/unauthenticated.error";
import type { VisibilityResponse } from "../../domain/schemas/api.schema";
import type { Caller } from "../../domain/schemas/caller.schema";
import type { RunVisibility } from "../../domain/schemas/run.schema";
import type { RunRepositoryPort } from "../ports/run-repository.port";

export type SetRunVisibility = {
  execute(runId: string, visibility: RunVisibility, caller: Caller | undefined): Promise<VisibilityResponse>;
};

// PATCH /api/trees/:runId (C105): the owner shares a map (unlisted / public) or makes it private again. Anyone
// else - including a reader of a public run - gets the same 404 as for an unknown run, so ownership cannot be
// probed. No LLM call, one row updated.
export function createSetRunVisibility({ runRepo }: { runRepo: RunRepositoryPort }): SetRunVisibility {
  return {
    async execute(runId, visibility, caller) {
      if (caller === undefined) throw new UnauthenticatedError("Sign in to share a map.");
      const run = await runRepo.get(runId);
      if (run === undefined || !isRunOwner(run, caller)) throw new RunNotFoundError(runId);
      if (run.visibility !== visibility) await runRepo.setVisibility(runId, visibility);
      return { runId, visibility };
    },
  };
}

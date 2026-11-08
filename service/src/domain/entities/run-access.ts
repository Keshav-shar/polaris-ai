import type { Caller } from "../schemas/caller.schema";
import type { Run } from "../schemas/run.schema";

// The ONE read rule (C105): a run is readable by its owner, or by anyone when it is not private. A run with no
// owner was built with auth off (C137) and stays readable by anyone, as every run was before Phase 12. Callers
// that fail it answer 404, never 403, so run and node ids cannot be probed.
export function canReadRun(run: Pick<Run, "ownerId" | "visibility">, caller: Caller | undefined): boolean {
  if (run.ownerId === undefined) return true;
  if ((run.visibility ?? "private") !== "private") return true;
  return caller !== undefined && caller.userId === run.ownerId;
}

// Changing a run (its visibility) is for its owner only. An ownerless run has no owner to be.
export function isRunOwner(run: Pick<Run, "ownerId">, caller: Caller | undefined): boolean {
  return run.ownerId !== undefined && caller !== undefined && caller.userId === run.ownerId;
}

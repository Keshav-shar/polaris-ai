import type { RunsResponse } from "../../domain/schemas/api.schema";
import type { RunRepositoryPort } from "../ports/run-repository.port";

export type ListRuns = {
  execute(limit: number): Promise<RunsResponse>;
};

// Read-only and LLM-free: the Codex needs to know which runs exist before it can fetch their trees.
// Deliberately returns the run record only, not node counts - those live in the tree read model, and
// fetching every tree here would turn one page load into an unbounded read.
export function createListRuns({ runs }: { runs: RunRepositoryPort }): ListRuns {
  return {
    async execute(limit: number) {
      const found = await runs.list(limit);
      return {
        runs: found.map((run) => ({
          runId: run.runId,
          topic: run.topic,
          maxDepth: run.maxDepth,
          status: run.status,
          ...(run.haltReason === undefined ? {} : { haltReason: run.haltReason }),
        })),
      };
    },
  };
}

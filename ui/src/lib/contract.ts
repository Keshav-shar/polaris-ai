// The single file allowed to import from service/src, and only types: no Zod or runtime code reaches the browser.
export type { ApiError, HealthResponse, StartTreeResponse, TreeRequestBody, TreeResponse } from "@service/domain/schemas/api.schema";
export type { TreeNode, TreeNodeStatus } from "@service/domain/schemas/node.schema";
// Phase 8 polls until the run leaves `constructing`; `halted` is terminal too, or the UI polls forever.
export type { RunStatus } from "@service/domain/schemas/run.schema";

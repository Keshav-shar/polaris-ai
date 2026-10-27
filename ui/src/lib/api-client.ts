import type {
  ApiError,
  HealthResponse,
  NodeResponse,
  RunsResponse,
  RunStatus,
  RunSummary,
  StartTreeResponse,
  TreeNode,
  TreeNodeStatus,
  TreeResponse,
} from "./contract";

// Must be referenced literally so Next inlines it into the browser bundle.
export const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// A failure the API described in its own error envelope, so the UI can react to the CODE rather than
// pattern-match a message: `quota_exhausted` and `run_in_progress` are refusals to spend LLM quota and
// carry Retry-After, `llm_not_configured` is a 503 the user fixes in service/.env.
export class ApiClientError extends Error {
  readonly name = "ApiClientError";
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

// The service's enums, repeated as runtime values because only TYPES may cross the package boundary
// (ui/README.md). The assignments below fail `tsc` if either enum gains or loses a member, so the
// duplication cannot drift silently - it becomes a typecheck error in this file.
const RUN_STATUSES = ["constructing", "constructed", "done", "failed", "halted"] as const;
const NODE_STATUSES = ["pending", "expanded", "done", "failed", "blocked"] as const;
type NoMember<T extends never> = T;
// Errors if the service ADDS a member these arrays are missing...
type _AllRunStatuses = NoMember<Exclude<RunStatus, (typeof RUN_STATUSES)[number]>>;
type _AllNodeStatuses = NoMember<Exclude<TreeNodeStatus, (typeof NODE_STATUSES)[number]>>;
// ...and if it REMOVES or renames one these arrays still list.
type _NoStrayRunStatuses = NoMember<Exclude<(typeof RUN_STATUSES)[number], RunStatus>>;
type _NoStrayNodeStatuses = NoMember<Exclude<(typeof NODE_STATUSES)[number], TreeNodeStatus>>;

// A run is still moving while its tree is being built AND while its scrolls are being written. Since
// C91 the article pass overlaps construction, so scrolls appear during `constructing` too and the tail
// of the pass runs in `constructed`; stopping at either left the star markers frozen and the reader
// showing "not yet written" until a manual reload. `done`, `halted` and
// `failed` are terminal, or the UI polls forever for a tree that will never arrive
// (service run.schema.ts, docs/conflicts.md C55).
export function isRunInProgress(status: RunStatus): boolean {
  return status === "constructing" || status === "constructed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isTreeNode(value: unknown): value is TreeNode {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.topic === "string" &&
    typeof value.depth === "number" &&
    typeof value.brief === "string" &&
    isOneOf(value.status, NODE_STATUSES) &&
    Array.isArray(value.children) &&
    value.children.every(isTreeNode)
  );
}

function isStats(value: unknown): value is TreeResponse["stats"] {
  const keys = ["nodesDone", "nodesFailed", "nodesSkipped", "articlesDone", "articlesFailed"] as const;
  return isRecord(value) && keys.every((k) => typeof value[k] === "number");
}

function isTreeResponse(value: unknown): value is TreeResponse {
  if (!isRecord(value) || !isRecord(value.run) || !isStats(value.stats)) return false;
  const run = value.run;
  return (
    typeof run.runId === "string" &&
    typeof run.topic === "string" &&
    typeof run.maxDepth === "number" &&
    isOneOf(run.status, RUN_STATUSES) &&
    (run.haltReason === undefined || typeof run.haltReason === "string") &&
    (value.tree === null || isTreeNode(value.tree))
  );
}

function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    isRecord(value) &&
    value.status === "ok" &&
    typeof value.llmConfigured === "boolean"
  );
}

function isApiError(value: unknown): value is ApiError {
  return isRecord(value) && isRecord(value.error) && typeof value.error.code === "string";
}

// Retry-After is seconds (the API never sends the HTTP-date form). A value we cannot read must not
// become 0, which would tell the UI to retry at once - the opposite of what a 429 means.
function retryAfterSeconds(res: Response): number | undefined {
  const header = res.headers.get("Retry-After");
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

async function failureFrom(res: Response): Promise<ApiClientError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const { code, message } = isApiError(body)
    ? { code: body.error.code, message: body.error.message }
    : { code: "unexpected_response", message: `Request failed with HTTP ${res.status}` };
  return new ApiClientError(code, message, res.status, retryAfterSeconds(res));
}

async function request(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${apiBaseUrl}${path}`, { ...init, cache: "no-store" });
  if (!res.ok) throw await failureFrom(res);
  return res.json();
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const body = await request("/health", { signal });
  if (!isHealthResponse(body)) throw new Error("Health check returned an unexpected body");
  return body;
}

// maxDepth is optional: omitted, the service uses the depth stated in the prompt, else its default. Either
// way the run's hard ceiling stays MAX_NODES_PER_RUN, which no request can raise (docs/conflicts.md C62, C100).
export async function startTree(
  prompt: string,
  maxDepth?: number,
  signal?: AbortSignal,
): Promise<StartTreeResponse> {
  const body = await request("/api/trees", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(maxDepth === undefined ? { prompt } : { prompt, maxDepth }),
    signal,
  });
  if (!isRecord(body) || typeof body.runId !== "string") {
    throw new Error("Starting a tree returned an unexpected body");
  }
  return { runId: body.runId };
}

export async function getTree(runId: string, signal?: AbortSignal): Promise<TreeResponse> {
  const body = await request(`/api/trees/${encodeURIComponent(runId)}`, { signal });
  if (!isTreeResponse(body)) throw new Error("The tree endpoint returned an unexpected body");
  return body;
}

function isRunSummary(value: unknown): value is RunSummary {
  return (
    isRecord(value) &&
    typeof value.runId === "string" &&
    typeof value.topic === "string" &&
    typeof value.maxDepth === "number" &&
    isOneOf(value.status, RUN_STATUSES) &&
    (value.haltReason === undefined || typeof value.haltReason === "string")
  );
}

// One call for the reader: the node, its article and its questions. Before this endpoint existed the
// reader had to list runs and walk every tree to find one node.
export async function getNode(nodeId: string, signal?: AbortSignal): Promise<NodeResponse> {
  const body = await request(`/api/nodes/${encodeURIComponent(nodeId)}`, { signal });
  if (!isRecord(body) || !isRecord(body.node)) {
    throw new Error("The node endpoint returned an unexpected body");
  }
  // `article` and `quiz` are legitimately null - unwritten, and "no evidence to cite" respectively - so
  // the guard checks the node only and lets the render decide what to show.
  return body as NodeResponse;
}

// The Codex needs to know which runs exist before it can fetch their trees. Runs are in-memory until
// Phase 12, so an empty list after a service restart is expected, not an error.
export async function getRuns(signal?: AbortSignal): Promise<RunsResponse> {
  const body = await request("/api/runs", { signal });
  if (!isRecord(body) || !Array.isArray(body.runs) || !body.runs.every(isRunSummary)) {
    throw new Error("The runs endpoint returned an unexpected body");
  }
  return { runs: body.runs };
}

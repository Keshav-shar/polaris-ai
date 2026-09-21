// Relative imports only: ui/ type-checks this file, and there `@/` points at ui/src (docs/conflicts.md C41).
import { z } from "zod";
import {
  ANCESTOR_WINDOW,
  BRIEF_MAX_WORDS,
  DEFAULT_MAX_DEPTH,
  MAX_DEPTH_CEILING,
} from "../../config/constants";
import { countWords } from "../../shared/words";

export const ParsedRequest = z.object({
  topic: z.string().trim().min(1),
  maxDepth: z.number().int().min(1).max(MAX_DEPTH_CEILING).default(DEFAULT_MAX_DEPTH),
});
export type ParsedRequest = z.infer<typeof ParsedRequest>;

export const LayerPosition = z.enum(["normal", "taper", "leaf"]);
export type LayerPosition = z.infer<typeof LayerPosition>;

export const AncestorRef = z.object({
  depth: z.number().int().min(0),
  topic: z.string(),
  brief: z.string(), // parent context = topic + brief of the nearest levels
});
export type AncestorRef = z.infer<typeof AncestorRef>;

export const NodeContext = z.object({
  depth: z.number().int().min(0),
  maxDepth: z.number().int().min(1),
  position: LayerPosition,
  ancestors: z.array(AncestorRef).max(ANCESTOR_WINDOW), // nearest levels only, never the full chain
});
export type NodeContext = z.infer<typeof NodeContext>;

export const Brief = z
  .string()
  .trim()
  .min(1)
  .refine((s) => countWords(s) < BRIEF_MAX_WORDS, {
    message: `brief must be fewer than ${BRIEF_MAX_WORDS} words`,
  });
export type Brief = z.infer<typeof Brief>;

// LLM output of the expander. Children must be [] at the leaf layer (enforced by the verifier).
export const ExpandOutput = z.object({
  brief: Brief,
  children: z.array(z.string()),
});
export type ExpandOutput = z.infer<typeof ExpandOutput>;

// What the API returns to the UI. EVERY known node is returned, whatever its status, so a run that stops
// early still shows the tree it managed to build (docs/conflicts.md C54).
// `pending` = known but not yet expanded (brief is ""), `expanded` = brief written, children still
// building, `done`/`failed` = terminal. `blocked` is DERIVED by the read model for a non-terminal node of
// a halted run - it is never stored.
export const TreeNodeStatus = z.enum(["pending", "expanded", "done", "failed", "blocked"]);
export type TreeNodeStatus = z.infer<typeof TreeNodeStatus>;

export const TreeNode = z.object({
  id: z.uuid(),
  topic: z.string(),
  depth: z.number().int().min(0),
  brief: z.string(), // "" until the node has been expanded
  status: TreeNodeStatus,
  get children() {
    return z.array(TreeNode);
  },
});
export type TreeNode = z.infer<typeof TreeNode>;

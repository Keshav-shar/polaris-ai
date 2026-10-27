// Relative imports only: ui/ type-checks this file, and there `@/` points at ui/src (docs/conflicts.md C41).
import { z } from "zod";
import { ANCESTOR_WINDOW, BRIEF_MAX_WORDS, TOPIC_MAX_CHARS } from "../../config/constants";
import { countWords } from "../../shared/words";

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

// A topic as a node carries it: trimmed, non-empty and bounded, so model output cannot inflate every prompt
// below it (docs/conflicts.md C103).
export const Topic = z.string().trim().min(1).max(TOPIC_MAX_CHARS);
export type Topic = z.infer<typeof Topic>;

// One child as its PARENT writes it: the parent names the subtopic and scopes it in a brief, so the child
// never spends a call on its own brief and a final-layer child is never called at all (docs/conflicts.md C99).
export const ChildDraft = z.object({ topic: Topic, brief: Brief });
export type ChildDraft = z.infer<typeof ChildDraft>;

// RAW LLM output, deliberately lenient per child: a single bad child is DROPPED by the verifier rather than
// failing the parse, because a failed parse costs a repair request (docs/conflicts.md C99).
const RawChild = z.object({ topic: z.string(), brief: z.string() });

// Interior expansion: the node's own brief came from its parent, so only children are asked for.
export const ExpandOutput = z.object({ children: z.array(RawChild) });
export type ExpandOutput = z.infer<typeof ExpandOutput>;

// Root expansion. It absorbed the parser (docs/conflicts.md C100): it reads the learner's raw request and
// names the topic, writes the root's brief, and its children - one call where there used to be two.
export const RootExpandOutput = z.object({ topic: z.string(), brief: z.string(), children: z.array(RawChild) });
export type RootExpandOutput = z.infer<typeof RootExpandOutput>;

// Either reply, before verification. The verifier is the only consumer.
export type RawExpansion = ExpandOutput & Partial<Pick<RootExpandOutput, "topic" | "brief">>;

// A VERIFIED expansion, as the constructor returns it and the cache stores it. `topic` and `brief` are set
// for the root only; every other node's brief arrives with its construct message.
export type Expansion = { topic?: Topic; brief?: Brief; children: ChildDraft[] };

// What the API returns to the UI. EVERY known node is returned, whatever its status, so a run that stops
// early still shows the tree it managed to build (docs/conflicts.md C54).
// `pending` = known but not yet expanded, `expanded` = children decided and still
// building, `done`/`failed` = terminal. `blocked` is DERIVED by the read model for a non-terminal node of
// a halted run - it is never stored.
export const TreeNodeStatus = z.enum(["pending", "expanded", "done", "failed", "blocked"]);
export type TreeNodeStatus = z.infer<typeof TreeNodeStatus>;

// Only the terminal halves of ArticleStatus reach the read model: a node either has its scroll or does
// not. `in_progress` is in-flight state and belongs to the expiring store, not to the API.
export const ArticleWriteStatus = z.enum(["done", "failed"]);
export type ArticleWriteStatus = z.infer<typeof ArticleWriteStatus>;

export const TreeNode = z.object({
  id: z.uuid(),
  topic: z.string(),
  depth: z.number().int().min(0),
  // Written by the node's PARENT when it is created (C99); "" only for the root until its own call returns.
  brief: z.string(),
  status: TreeNodeStatus,
  // The ARTICLE's state, which moves independently of `status`: a node is `done` the moment it is
  // expanded, long before its scroll is written. Absent until the article pass reaches it, which is what
  // lets the UI show scrolls appearing one by one (progressive display).
  articleStatus: ArticleWriteStatus.optional(),
  // Set only alongside `articleStatus: "failed"`, so the reader can say why a scroll is missing instead
  // of showing the same "not yet written" it shows for one that is merely still queued.
  articleFailureReason: z.string().optional(),
  get children() {
    return z.array(TreeNode);
  },
});
export type TreeNode = z.infer<typeof TreeNode>;

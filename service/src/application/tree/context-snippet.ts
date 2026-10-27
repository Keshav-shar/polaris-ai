import type { NodeContext } from "../../domain/schemas/node.schema";

// The per-position text (docs/traversal-algorithm.md). Never states a number of children (EXPAND.MAX_CHILDREN
// stays hidden). Instructions only: the ancestor trail used to be spelled out here, OUTSIDE the data block,
// which put model-written topics where instructions are read - it now lives only inside <node> (C103).
//
// A node is expanded only while it has a layer beneath it: the final layer is written by its parent and never
// called (C99). So `taper` means "your children ARE the final layer" and their briefs must stand alone.
export function buildContextSnippet(ctx: NodeContext): string {
  const remaining = ctx.maxDepth - ctx.depth;
  const head = `Depth ${ctx.depth} of ${ctx.maxDepth} (${remaining} levels remaining). `;
  switch (ctx.position) {
    case "normal":
      return (
        head +
        "Return the full set of distinct subtopics a learner should explore next, each with a brief that scopes it " +
        "so its own subtopics can be planned from it."
      );
    case "taper":
      return (
        head +
        "The tree is near its fixed height and your subtopics are its FINAL layer: return fewer, more specific " +
        "subtopics, and make each brief state everything that subtopic must teach, because it will not be broken " +
        "down further."
      );
    case "leaf":
      // Unreachable through expand-node (a final-layer node is never called); kept so the switch stays total.
      return head + "This is the final layer: return an empty children list.";
  }
}

import { ANCESTOR_WINDOW } from "../../config/constants";
import type { NodeContext } from "../../domain/schemas/node.schema";

// Text fixed by docs/node-builder-mvp-spec.md. Never states a number of children (EXPAND.MAX_CHILDREN stays hidden).
export function buildContextSnippet(ctx: NodeContext): string {
  const remaining = ctx.maxDepth - ctx.depth;
  const trail = ctx.ancestors.map((a) => a.topic).join(" → ") || "(root)";
  const head =
    `Depth ${ctx.depth} of ${ctx.maxDepth} (${remaining} levels remaining). ` +
    `Ancestor path (last ${ANCESTOR_WINDOW} levels): ${trail}. `;
  switch (ctx.position) {
    case "normal":
      return head + "Return a brief and the full set of distinct subtopics a learner should explore next.";
    case "taper":
      return head + "The tree is near its fixed height: return a brief and fewer, more specific subtopics.";
    case "leaf":
      return head + "This is the final layer: return a brief only and an empty children list.";
  }
}

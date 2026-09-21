import { ConstructionRejectedError } from "../../domain/errors/construction-rejected.error";
import { type AncestorRef, Brief, type ExpandOutput, type LayerPosition } from "../../domain/schemas/node.schema";
import { cleanChildren } from "../../domain/traversal/clean-children";

export type VerifyRequest = {
  output: ExpandOutput;
  topic: string;
  ancestors: readonly AncestorRef[];
  position: LayerPosition;
};

export type VerifyResult = {
  output: ExpandOutput;
  strippedLeafChildren: number; // children removed by the leaf rule, for logging
};

// Pure construction verifier: brief, dedupe, cycle guard, leaf rule. The children cap is applied by
// construct-node through the consolidator, not here.
export function verifyExpansion({ output, topic, ancestors, position }: VerifyRequest): VerifyResult {
  const brief = Brief.safeParse(output.brief);
  if (!brief.success) throw new ConstructionRejectedError(`invalid brief: ${brief.error.issues[0]?.message}`);

  const children = cleanChildren(output.children, [topic, ...ancestors.map((a) => a.topic)]);
  if (position === "leaf") {
    return { output: { brief: brief.data, children: [] }, strippedLeafChildren: children.length };
  }
  return { output: { brief: brief.data, children }, strippedLeafChildren: 0 };
}

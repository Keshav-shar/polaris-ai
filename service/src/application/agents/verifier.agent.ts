import { ConstructionRejectedError } from "../../domain/errors/construction-rejected.error";
import {
  type AncestorRef,
  Brief,
  ChildDraft,
  type Expansion,
  type RawExpansion,
  Topic,
} from "../../domain/schemas/node.schema";
import { cleanChildren } from "../../domain/traversal/clean-children";

export type VerifyRequest = {
  output: RawExpansion;
  topic: string;
  ancestors: readonly AncestorRef[];
  // True for the root call, which must also name the topic and write the root's brief (C100).
  isRoot: boolean;
};

export type VerifyResult = {
  output: Expansion;
  droppedChildren: number; // children removed for an invalid topic or brief, for logging
};

// Pure construction verifier: root topic + brief, dedupe, cycle guard, and each child's topic and brief.
// A bad CHILD is dropped rather than failing the node, because failing it means another LLM request for an
// answer that is mostly usable (C99). The caps are applied by the constructor and the use-case, not here.
export function verifyExpansion({ output, topic, ancestors, isRoot }: VerifyRequest): VerifyResult {
  let rootTopic: string | undefined;
  let rootBrief: string | undefined;
  if (isRoot) {
    const brief = Brief.safeParse(output.brief ?? "");
    if (!brief.success) throw new ConstructionRejectedError(`invalid brief: ${brief.error.issues[0]?.message}`);
    rootBrief = brief.data;
    const named = Topic.safeParse(output.topic ?? "");
    if (!named.success) throw new ConstructionRejectedError(`invalid topic: ${named.error.issues[0]?.message}`);
    rootTopic = named.data;
  }

  const blocked = [topic, ...(rootTopic === undefined ? [] : [rootTopic]), ...ancestors.map((a) => a.topic)];
  const cleaned = cleanChildren(output.children, blocked);
  const children = cleaned.flatMap((child) => {
    const valid = ChildDraft.safeParse(child);
    return valid.success ? [valid.data] : [];
  });
  // Every child that survived dedup had an invalid topic or brief: that is a bad roll, not "no subtopics", so
  // the node is retried instead of silently becoming a leaf. Children dropped only as duplicates of the node
  // or its ancestors are not a bad roll - the node genuinely has nothing new below it.
  if (children.length === 0 && cleaned.length > 0) {
    throw new ConstructionRejectedError(`no valid children among ${cleaned.length}`);
  }

  return {
    output: {
      ...(rootTopic === undefined ? {} : { topic: rootTopic }),
      ...(rootBrief === undefined ? {} : { brief: rootBrief }),
      children,
    },
    droppedChildren: cleaned.length - children.length,
  };
}

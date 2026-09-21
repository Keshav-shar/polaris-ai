import { ANCESTOR_WINDOW } from "../../config/constants";
import type { AncestorRef } from "../schemas/node.schema";

// The ancestors a child's message carries: the parent's window plus the parent, nearest ANCESTOR_WINDOW levels only.
export function nextAncestors(ancestors: readonly AncestorRef[], parent: AncestorRef): AncestorRef[] {
  return [...ancestors, parent].slice(-ANCESTOR_WINDOW);
}

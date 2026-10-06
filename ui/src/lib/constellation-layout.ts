import type { TreeNode } from "./contract";

export type IndexedNode = { node: TreeNode; parentId: string | null };
export type TreeIndex = Map<string, IndexedNode>;

// One walk of the nested tree the API already returns, so the constellation needs no new endpoint.
export function indexTree(root: TreeNode | null): TreeIndex {
  const index: TreeIndex = new Map();
  if (root === null) return index;
  const stack: IndexedNode[] = [{ node: root, parentId: null }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    index.set(current.node.id, current);
    for (const child of current.node.children) stack.push({ node: child, parentId: current.node.id });
  }
  return index;
}

export type Placement = {
  node: TreeNode;
  role: "focus" | "parent" | "sibling" | "child";
  // Percentages of the viewport box, so the caller can position with plain CSS and stay responsive.
  x: number;
  y: number;
};

export type Constellation = {
  focus: TreeNode;
  parentId: string | null;
  placements: Placement[];
};

const FOCUS = { x: 50, y: 50 };
const PARENT_Y = 14;
const SIBLING_Y = 50;
const CHILD_Y = 86;

// Spread `count` items across a horizontal band, centred. One item sits in the middle rather than at the
// left edge, which is what makes a single child look deliberate instead of broken.
function spread(count: number, from: number, to: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(from + to) / 2];
  const step = (to - from) / (count - 1);
  return Array.from({ length: count }, (_, i) => from + step * i);
}

// Focus + context: the focused node, its parent, its siblings and its children - never the whole tree.
// A run may hold up to MAX_NODES_PER_RUN (500) nodes, so drawing everything would be unreadable and slow;
// this draws a neighbourhood, and the sidebar directory carries the full structure.
export function buildConstellation(index: TreeIndex, focusId: string): Constellation | null {
  const entry = index.get(focusId);
  if (entry === undefined) return null;

  const { node: focus, parentId } = entry;
  const parent = parentId === null ? undefined : index.get(parentId)?.node;
  const siblings = parent === undefined ? [] : parent.children.filter((s) => s.id !== focus.id);
  const children = focus.children;

  const placements: Placement[] = [{ node: focus, role: "focus", ...FOCUS }];

  if (parent !== undefined) {
    placements.push({ node: parent, role: "parent", x: 50, y: PARENT_Y });
  }

  // Siblings go left and right of the focus, split evenly so the focus stays centred.
  const half = Math.ceil(siblings.length / 2);
  const left = siblings.slice(0, half);
  const right = siblings.slice(half);
  spread(left.length, 8, 30).forEach((x, i) => {
    const node = left[i];
    if (node !== undefined) placements.push({ node, role: "sibling", x, y: SIBLING_Y });
  });
  spread(right.length, 70, 92).forEach((x, i) => {
    const node = right[i];
    if (node !== undefined) placements.push({ node, role: "sibling", x, y: SIBLING_Y });
  });

  // Children arc below. Wide fan-out is expected here: the expander caps children at 15.
  spread(children.length, 8, 92).forEach((x, i) => {
    const node = children[i];
    if (node === undefined) return;
    // A gentle arc rather than a flat row, so a wide sibling set reads as a constellation.
    const curve = children.length <= 1 ? 0 : Math.abs(x - 50) / 50;
    placements.push({ node, role: "child", x, y: CHILD_Y - curve * 8 });
  });

  return { focus, parentId, placements };
}

// Depth-first order, which is the order the sidebar directory lists the tree in.
export function flattenTree(root: TreeNode | null): TreeNode[] {
  if (root === null) return [];
  const out: TreeNode[] = [];
  const visit = (node: TreeNode): void => {
    out.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return out;
}

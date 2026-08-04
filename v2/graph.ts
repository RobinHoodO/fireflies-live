// EXPERIMENT — the conversation map.
//
// A meeting is a tree, not a line: every topic opens branches, you walk one,
// and the others sit there unwalked. This models that tree so it can be drawn
// live and walked back into.
//
//   active   — where the conversation is right now (the growing tip)
//   explored — walked, then moved on from
//   open     — surfaced but NOT taken: the path not taken, still available
//   dropped  — was open, now clearly irrelevant (drawn faint, never deleted)
//
// Pure helpers only. The React state lives in App.tsx.

export type GraphNodeState = "active" | "explored" | "open" | "dropped";
export const GRAPH_STATES: GraphNodeState[] = ["active", "explored", "open", "dropped"];

export type GraphNode = { id: number; label: string; parent: number | null; state: GraphNodeState; t: number };
export type PlacedNode = GraphNode & { depth: number; row: number };

// Tidy-ish layered layout: depth = distance from the root (x), row = a slot on
// the cross axis (y). Leaves take the next free row; a parent centres on its
// children. Deliberately not a force layout — a conversation has a direction,
// and left-to-right time reads better than a floating blob.
export function layoutTree(nodes: GraphNode[]): PlacedNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const ordered = [...nodes].sort((a, b) => a.t - b.t || a.id - b.id);
  const kids = new Map<number, GraphNode[]>();
  const roots: GraphNode[] = [];
  for (const n of ordered) {
    // A parent that doesn't exist (or is the node itself) means "root" —
    // the model will hand us dangling references eventually.
    const parent = n.parent != null && n.parent !== n.id && byId.has(n.parent) ? n.parent : null;
    if (parent == null) roots.push(n);
    else kids.set(parent, [...(kids.get(parent) ?? []), n]);
  }

  const placed: PlacedNode[] = [];
  const rowOf = new Map<number, number>();
  const seen = new Set<number>(); // also the cycle guard
  let nextRow = 0;

  const walk = (node: GraphNode, depth: number) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    const children = kids.get(node.id) ?? [];
    if (!children.length) {
      const row = nextRow++;
      rowOf.set(node.id, row);
      placed.push({ ...node, depth, row });
      return;
    }
    const firstRow = nextRow;
    for (const child of children) walk(child, depth + 1);
    const childRows = children.map(c => rowOf.get(c.id)).filter((r): r is number => r !== undefined);
    const row = childRows.length ? (Math.min(...childRows) + Math.max(...childRows)) / 2 : firstRow;
    rowOf.set(node.id, row);
    placed.push({ ...node, depth, row });
  };

  for (const root of roots) walk(root, 0);
  // Anything stranded by a cycle still gets drawn — losing a node silently
  // would be worse than drawing it in the wrong place.
  for (const node of ordered) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    const row = nextRow++;
    rowOf.set(node.id, row);
    placed.push({ ...node, depth: 0, row });
  }
  return placed;
}

// The walked route from the root to the tip — the "you are here" spine.
export function pathToRoot(nodes: GraphNode[], fromId: number | null): number[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const path: number[] = [];
  const seen = new Set<number>();
  let cursor = fromId;
  while (cursor != null && byId.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    path.unshift(cursor);
    cursor = byId.get(cursor)!.parent;
  }
  return path;
}

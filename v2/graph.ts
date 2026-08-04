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
export type PlacedNode = GraphNode & { depth: number; x: number; y: number; angle: number };

// Generous rings: each node carries a label hanging off it, and cramped rings
// turn a readable colony into overlapping text.
const RING = 260;
const JITTER = 34;  // how far a node may wander off its ring

// Deterministic pseudo-random in [0,1) from a node id. Mycelium is irregular,
// but the irregularity must be STABLE — a node that reshuffles every render
// reads as noise, not growth.
function wobble(id: number, salt: number): number {
  const h = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

// Same stable wobble, for the drawing layer (how far a filament bows sideways).
export const wobbleOf = (id: number) => wobble(id, 3);

// Radial hyphal layout: each node owns an angular wedge, its children split
// that wedge in proportion to how much subtree hangs off each, and every node
// sits one ring further out than its parent. Growth radiates outward from the
// first topic the way a colony spreads from a spore.
export function layoutMycelium(nodes: GraphNode[]): PlacedNode[] {
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

  // Subtree weight = leaf count, so a dense branch gets a wider wedge.
  const weights = new Map<number, number>();
  const weigh = (node: GraphNode, seen: Set<number>): number => {
    if (seen.has(node.id)) return 1;
    seen.add(node.id);
    const children = kids.get(node.id) ?? [];
    const w = children.length ? children.reduce((sum, c) => sum + weigh(c, seen), 0) : 1;
    weights.set(node.id, w);
    return w;
  };
  for (const root of roots) weigh(root, new Set());

  const placed: PlacedNode[] = [];
  const seen = new Set<number>(); // also the cycle guard
  // One root sits at the origin like a spore. Several roots — separate threads
  // of conversation — ring the centre instead, or they'd stack on one point.
  const solo = roots.length === 1;
  const rootRadius = solo ? 0 : RING * 0.62;

  const walk = (node: GraphNode, depth: number, from: number, to: number) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    const angle = (from + to) / 2 + (wobble(node.id, 1) - 0.5) * (to - from) * 0.22;
    const radius = depth === 0 ? rootRadius : depth * RING + (wobble(node.id, 2) - 0.5) * JITTER;
    placed.push({ ...node, depth, angle, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });

    const children = kids.get(node.id) ?? [];
    if (!children.length) return;
    // Children fan out around the direction this node already grew in, so a
    // filament keeps travelling outward instead of doubling back on itself.
    const total = children.reduce((sum, c) => sum + (weights.get(c.id) ?? 1), 0) || 1;
    const full = depth === 0 && solo;
    const spread = full ? Math.PI * 2 : Math.min(Math.PI * 0.85, (to - from) * 1.1);
    let cursor = full ? 0 : angle - spread / 2;
    for (const child of children) {
      const share = ((weights.get(child.id) ?? 1) / total) * spread;
      walk(child, depth + 1, cursor, cursor + share);
      cursor += share;
    }
  };

  const rootSpread = (Math.PI * 2) / Math.max(1, roots.length);
  roots.forEach((root, i) => walk(root, 0, i * rootSpread, (i + 1) * rootSpread));

  // Anything stranded by a cycle still gets drawn — losing a node silently
  // would be worse than drawing it in the wrong place.
  let stray = 0;
  for (const node of ordered) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    const angle = stray++ * 0.9;
    placed.push({ ...node, depth: 0, angle, x: Math.cos(angle) * RING, y: Math.sin(angle) * RING });
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

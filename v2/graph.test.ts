// Pins the conversation-map layout: nothing may be silently dropped, growth
// radiates outward, and the tree survives whatever the model hands us
// (dangling parents, cycles, self-parents).
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutMycelium, pathToRoot, graftOrphans, wrapLabel, hostNodeId, type GraphNode } from "./graph.ts";

const node = (id: number, parent: number | null, over: Partial<GraphNode> = {}): GraphNode =>
  ({ id, label: `n${id}`, parent, state: "explored", t: id, ...over });

const placedById = (nodes: GraphNode[]) => new Map(layoutMycelium(nodes).map(p => [p.id, p]));
const radius = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);

test("depth follows the parent chain", () => {
  const p = placedById([node(1, null), node(2, 1), node(3, 2)]);
  assert.deepEqual([p.get(1)!.depth, p.get(2)!.depth, p.get(3)!.depth], [0, 1, 2]);
});

test("each generation sits further out than the last", () => {
  const p = placedById([node(1, null), node(2, 1), node(3, 2)]);
  assert.equal(radius(p.get(1)!), 0); // a lone root is the spore at the centre
  assert.ok(radius(p.get(2)!) < radius(p.get(3)!));
});

test("separate root threads ring the centre instead of stacking on it", () => {
  const p = placedById([node(1, null), node(2, null), node(3, null)]);
  const points = [1, 2, 3].map(id => p.get(id)!);
  assert.ok(points.every(pt => radius(pt) > 0));
  // No two roots share a position.
  assert.equal(new Set(points.map(pt => `${Math.round(pt.x)},${Math.round(pt.y)}`)).size, 3);
});

test("siblings grow in different directions", () => {
  const p = placedById([node(1, null), node(2, 1), node(3, 1)]);
  assert.notEqual(p.get(2)!.angle, p.get(3)!.angle);
});

test("layout is stable across runs — growth, not noise", () => {
  const nodes = [node(1, null), node(2, 1), node(3, 1), node(4, 2)];
  assert.deepEqual(layoutMycelium(nodes), layoutMycelium(nodes));
});

test("a dangling parent is treated as a root, not dropped", () => {
  const p = placedById([node(1, null), node(2, 99)]);
  assert.equal(p.get(2)!.depth, 0);
  assert.equal(p.size, 2);
});

test("a cycle does not hang and every node still gets placed", () => {
  const placed = layoutMycelium([node(1, 2), node(2, 1)]);
  assert.equal(placed.length, 2);
});

test("a node parented to itself is a root", () => {
  assert.equal(layoutMycelium([node(1, 1)])[0].depth, 0);
});

test("every input node comes out exactly once, with finite coordinates", () => {
  const nodes = [node(1, null), node(2, 1), node(3, 1), node(4, 2), node(5, 99), node(6, 6)];
  const placed = layoutMycelium(nodes);
  assert.deepEqual(placed.map(p => p.id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  assert.ok(placed.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test("a dense branch gets a wider wedge than a bare one", () => {
  // 2 has three leaves hanging off it, 3 has none.
  const placed = layoutMycelium([node(1, null), node(2, 1), node(3, 1), node(4, 2), node(5, 2), node(6, 2)]);
  const leaves = placed.filter(p => [4, 5, 6].includes(p.id)).map(p => p.angle);
  assert.ok(Math.max(...leaves) - Math.min(...leaves) > 0);
});

test("graftOrphans leaves exactly one root", () => {
  const grafted = graftOrphans([node(1, null, { t: 1 }), node(2, null, { t: 2 }), node(3, 99, { t: 3 })]);
  assert.deepEqual(grafted.filter(n => n.parent === null).map(n => n.id), [1]);
});

test("an orphan is grafted onto the live tip, not the trunk", () => {
  const grafted = graftOrphans([node(1, null, { t: 1 }), node(2, 1, { t: 2 }), node(3, null, { t: 3 })], 2);
  assert.equal(grafted.find(n => n.id === 3)!.parent, 2);
});

test("grafting never closes a loop through a descendant", () => {
  // 3 descends from 2; asking to graft 2 onto 3 must fall back to the trunk.
  const grafted = graftOrphans([node(1, null, { t: 1 }), node(2, null, { t: 2 }), node(3, 2, { t: 3 })], 3);
  assert.equal(grafted.find(n => n.id === 2)!.parent, 1);
});

test("a grafted graph lays out as one connected colony", () => {
  const grafted = graftOrphans([node(1, null, { t: 1 }), node(2, null, { t: 2 }), node(3, null, { t: 3 })]);
  const placed = layoutMycelium(grafted);
  assert.equal(placed.filter(p => p.depth === 0).length, 1);
  assert.equal(placed.length, 3);
});

test("wrapLabel breaks lines instead of cutting words", () => {
  assert.deepEqual(wrapLabel("pricing model and scaling", 12), ["pricing", "model and", "scaling"]);
  assert.deepEqual(wrapLabel("short", 20), ["short"]);
});

test("wrapLabel only ellipsises once it is out of lines", () => {
  const lines = wrapLabel("one two three four five six seven eight", 9, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith("…"));
});

test("a word longer than the line stays whole rather than being chopped", () => {
  assert.deepEqual(wrapLabel("internationalisation", 8), ["internationalisation"]);
});

test("hostNodeId picks the topic that was live when an item surfaced", () => {
  const nodes = [node(1, null, { t: 100 }), node(2, 1, { t: 200 }), node(3, 2, { t: 300 })];
  assert.equal(hostNodeId(250, nodes), 2);
  assert.equal(hostNodeId(300, nodes), 3);
  assert.equal(hostNodeId(999, nodes), 3);
  assert.equal(hostNodeId(1, nodes), 1); // older than the first topic → the trunk
  assert.equal(hostNodeId(50, []), null);
});

test("pathToRoot walks the spine root-first", () => {
  assert.deepEqual(pathToRoot([node(1, null), node(2, 1), node(3, 2)], 3), [1, 2, 3]);
});

test("pathToRoot survives a cycle and an unknown tip", () => {
  assert.deepEqual(pathToRoot([node(1, 2), node(2, 1)], 1), [2, 1]);
  assert.deepEqual(pathToRoot([node(1, null)], 99), []);
  assert.deepEqual(pathToRoot([node(1, null)], null), []);
});

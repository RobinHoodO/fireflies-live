// Pins the conversation-map layout: nothing may be silently dropped, and the
// tree must survive whatever the model hands us (dangling parents, cycles).
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutTree, pathToRoot, type GraphNode } from "./graph.ts";

const node = (id: number, parent: number | null, over: Partial<GraphNode> = {}): GraphNode =>
  ({ id, label: `n${id}`, parent, state: "explored", t: id, ...over });

const placedById = (nodes: GraphNode[]) => new Map(layoutTree(nodes).map(p => [p.id, p]));

test("depth follows the parent chain", () => {
  const p = placedById([node(1, null), node(2, 1), node(3, 2)]);
  assert.deepEqual([p.get(1)!.depth, p.get(2)!.depth, p.get(3)!.depth], [0, 1, 2]);
});

test("siblings get their own rows and the parent centres between them", () => {
  const p = placedById([node(1, null), node(2, 1), node(3, 1)]);
  assert.notEqual(p.get(2)!.row, p.get(3)!.row);
  assert.equal(p.get(1)!.row, (p.get(2)!.row + p.get(3)!.row) / 2);
});

test("a dangling parent is treated as a root, not dropped", () => {
  const p = placedById([node(1, null), node(2, 99)]);
  assert.equal(p.get(2)!.depth, 0);
  assert.equal(p.size, 2);
});

test("a cycle does not hang and every node still gets placed", () => {
  const placed = layoutTree([node(1, 2), node(2, 1)]);
  assert.equal(placed.length, 2);
});

test("a node parented to itself is a root", () => {
  assert.equal(layoutTree([node(1, 1)])[0].depth, 0);
});

test("every input node comes out exactly once", () => {
  const nodes = [node(1, null), node(2, 1), node(3, 1), node(4, 2), node(5, 99)];
  const placed = layoutTree(nodes);
  assert.deepEqual(placed.map(p => p.id).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

test("pathToRoot walks the spine root-first", () => {
  assert.deepEqual(pathToRoot([node(1, null), node(2, 1), node(3, 2)], 3), [1, 2, 3]);
});

test("pathToRoot survives a cycle and an unknown tip", () => {
  assert.deepEqual(pathToRoot([node(1, 2), node(2, 1)], 1), [2, 1]);
  assert.deepEqual(pathToRoot([node(1, null)], 99), []);
  assert.deepEqual(pathToRoot([node(1, null)], null), []);
});

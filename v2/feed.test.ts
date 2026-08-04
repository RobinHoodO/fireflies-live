// Pins the feed priority blend: Robin's votes must always beat the AI's ranking.
import { test } from "node:test";
import assert from "node:assert/strict";
import { prioritize, applyOrder, sortFeed, matchesFilter, FILTER_TYPES, type FeedItem } from "./feed.ts";
import { FEED_TYPES } from "./backend.ts";

const item = (id: number, over: Partial<FeedItem> = {}): FeedItem =>
  ({ id, type: "note", text: `item ${id}`, t: id, votes: 0, source: "ai", ...over });

const ids = (items: FeedItem[]) => items.map(i => i.id);

test("an upvoted item floats to the top", () => {
  assert.deepEqual(ids(prioritize([item(1), item(2, { votes: 2 }), item(3, { votes: 1 })])), [2, 3, 1]);
});

test("equal votes keep the AI's incoming order (stable)", () => {
  assert.deepEqual(ids(prioritize([item(3), item(1), item(2)])), [3, 1, 2]);
});

test("done items sink below everything, even when upvoted", () => {
  assert.deepEqual(ids(prioritize([item(1, { votes: 5, status: "done" }), item(2)])), [2, 1]);
});

test("a later AI ranking cannot bury a voted item", () => {
  const items = [item(1), item(2, { votes: 1 }), item(3)];
  assert.deepEqual(ids(prioritize(applyOrder(items, [3, 1, 2]))), [2, 3, 1]);
});

test("applyOrder keeps items the AI left out of its ranking", () => {
  assert.deepEqual(ids(applyOrder([item(1), item(2), item(3)], [3])), [3, 1, 2]);
});

test("applyOrder ignores unknown and duplicate ids", () => {
  assert.deepEqual(ids(applyOrder([item(1), item(2)], [2, 2, 99])), [2, 1]);
});

test("priority sort is the array order; newest sort reorders by time", () => {
  const items = [item(1), item(3), item(2)];
  assert.deepEqual(ids(sortFeed(items, "priority")), [1, 3, 2]);
  assert.deepEqual(ids(sortFeed(items, "newest")), [3, 2, 1]);
  assert.deepEqual(ids(sortFeed(items, "oldest")), [1, 2, 3]);
});

test("the agenda chip covers points to cover — but not branches", () => {
  assert.ok(matchesFilter("topic", "agenda"));
  assert.ok(matchesFilter("clarify", "agenda"));
  assert.equal(matchesFilter("branch", "agenda"), false);
  assert.equal(matchesFilter("ask", "agenda"), false);
});

test("branch is its own chip", () => {
  assert.ok(matchesFilter("branch", "branch"));
  assert.equal(matchesFilter("topic", "branch"), false);
});

test("every feed type is reachable by exactly one chip", () => {
  for (const type of FEED_TYPES) {
    const chips = Object.keys(FILTER_TYPES).filter(f => matchesFilter(type, f));
    assert.deepEqual(chips.length, 1, `${type} is covered by ${chips.length} chips: ${chips}`);
  }
});

test("an unknown chip id matches nothing rather than everything", () => {
  assert.equal(matchesFilter("ask", "nope"), false);
});

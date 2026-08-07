// Pins the feed priority blend: Robin's votes must always beat the AI's ranking.
import { test } from "node:test";
import assert from "node:assert/strict";
import { prioritize, applyOrder, sortFeed, matchesFilter, anchorFor, isOpenPossibility, isNearDupe, garbledSpeakers, FILTER_TYPES, type FeedItem } from "./feed.ts";
import { FEED_TYPES } from "./backend.ts";
import { type GraphNode } from "./graph.ts";

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

// ── possibility vs record ────────────────────────────────────────
const gnode = (id: number, t: number): GraphNode => ({ id, label: `topic ${id}`, parent: id === 1 ? null : 1, state: "explored", t });
const GRAPH = [gnode(1, 100), gnode(2, 200), gnode(3, 300)];

test("an open ask travels with the conversation", () => {
  const ask = item(9, { type: "ask", t: 150 });
  assert.equal(anchorFor(ask, GRAPH, 3), 3);
});

test("once the moment has passed, the ask falls back to where it came up", () => {
  const stale = item(9, { type: "ask", t: 150, live: false });
  assert.equal(anchorFor(stale, GRAPH, 3), 1);
});

test("a note is history — it never moves, even while live-ish", () => {
  assert.equal(anchorFor(item(9, { type: "note", t: 250 }), GRAPH, 3), 2);
});

test("a handled possibility becomes history too", () => {
  assert.equal(anchorFor(item(9, { type: "ask", t: 150, status: "done" }), GRAPH, 3), 1);
});

test("with no tip, everything anchors to where it arose", () => {
  assert.equal(anchorFor(item(9, { type: "ask", t: 250 }), GRAPH, null), 2);
  assert.equal(anchorFor(item(9, { type: "ask", t: 250 }), GRAPH, 404), 2); // unknown tip
});

test("only asks, clarifies and branches are possibilities", () => {
  assert.ok(isOpenPossibility(item(1, { type: "ask" })));
  assert.ok(isOpenPossibility(item(2, { type: "clarify" })));
  assert.ok(isOpenPossibility(item(3, { type: "branch" })));
  assert.equal(isOpenPossibility(item(4, { type: "note" })), false);
  assert.equal(isOpenPossibility(item(5, { type: "do" })), false);
  assert.equal(isOpenPossibility(item(6, { type: "topic" })), false);
});

// ── near-duplicate suppression ──────────────────────────────────────
// Real pairs from the 2026-08-07 Max call, where reworded restatements ate
// enough of the feed to push genuine notes off the end of the cap.
test("a reworded restatement of the same ask is a dupe", () => {
  const existing = [item(1, { type: "ask", text: "Max: in routine meetings, which phase drains most—prep framing, staying present, or post-analysis?" })];
  assert.equal(isNearDupe("Max: which drains most—prep framing, staying present, or post-analysis?", "ask", existing), true);
});

test("a genuinely different ask survives", () => {
  const existing = [item(1, { type: "ask", text: "Max: in routine meetings, which phase drains most—prep framing, staying present, or post-analysis?" })];
  assert.equal(isNearDupe("Max: would Robin sandbox and audit skills before touching transaction data?", "ask", existing), false);
});

// A Note recording what was said is not the Ask that prompted it, even when
// they share most of their words — losing the record was the original bug.
test("a note is never deduped against a similarly worded ask", () => {
  const existing = [item(1, { type: "ask", text: "Max: for routine work meetings—would async personal notes (not real-time) feel less intrusive than live mediation?" })];
  assert.equal(isNearDupe("Max open to async personal notes (not real-time)—less intrusive, clearer than live mediation.", "note", existing), false);
});

test("empty text is never a dupe", () => {
  assert.equal(isNearDupe("", "note", [item(1, { text: "anything" })]), false);
});

// ── wrong-language ASR detection ────────────────────────────────────
// Fireflies' realtime stream locked Robin to Cyrillic for a whole hour while
// transcribing Max fine, so the copilot advised on half a conversation.
test("a speaker locked to the wrong script is flagged, the others are not", () => {
  const lines = [
    ...Array.from({ length: 8 }, () => ({ speaker: "Robin", text: "Я. Ее. Експеримент." })),
    ...Array.from({ length: 8 }, () => ({ speaker: "Max", text: "Yeah, somehow I speak in English." })),
  ];
  assert.deepEqual(garbledSpeakers(lines), ["Robin"]);
});

test("a stray foreign phrase in an otherwise clean speaker is not flagged", () => {
  const lines = [
    { speaker: "Robin", text: "Так, exactly." },
    ...Array.from({ length: 9 }, () => ({ speaker: "Robin", text: "That is what I meant." })),
  ];
  assert.deepEqual(garbledSpeakers(lines), []);
});

test("too few lines to judge yet — stay quiet", () => {
  assert.deepEqual(garbledSpeakers([{ speaker: "Robin", text: "Я. Ее." }, { speaker: "Robin", text: "Аа. А." }]), []);
});

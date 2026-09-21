// Pins the Jev turn-trigger gating: only a fresh line from the other side,
// throttled, and only a clear probability bypasses the "Say this" floor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldConsultJev, clearsTurnBar, JEV_TURN_THRESHOLD, JEV_MIN_INTERVAL_MS } from "./turn.ts";

const gate = (over: Partial<Parameters<typeof shouldConsultJev>[0]> = {}) =>
  shouldConsultJev({ hasNewFinalLine: true, lastSpeakerIsHost: false, now: 10_000, lastJevCallAt: 0, ...over });

test("a fresh line from the other side, past the throttle, is consulted", () => {
  assert.equal(gate({ now: JEV_MIN_INTERVAL_MS, lastJevCallAt: 0 }), true);
});

test("no new final line means nothing fresh to judge", () => {
  assert.equal(gate({ hasNewFinalLine: false }), false);
});

test("never consulted while the host spoke last — nothing to hand back", () => {
  assert.equal(gate({ lastSpeakerIsHost: true }), false);
});

test("throttled: a call within JEV_MIN_INTERVAL_MS of the last one is skipped", () => {
  assert.equal(gate({ now: 1000, lastJevCallAt: 0 }), false);
  assert.equal(gate({ now: JEV_MIN_INTERVAL_MS - 1, lastJevCallAt: 0 }), false);
});

test("exactly at the throttle boundary is allowed", () => {
  assert.equal(gate({ now: 5000 + JEV_MIN_INTERVAL_MS, lastJevCallAt: 5000 }), true);
});

test("a probability at or above the threshold clears the bar", () => {
  assert.equal(clearsTurnBar(JEV_TURN_THRESHOLD), true);
  assert.equal(clearsTurnBar(0.95), true);
});

test("a probability below the threshold does not clear the bar", () => {
  assert.equal(clearsTurnBar(JEV_TURN_THRESHOLD - 0.01), false);
  assert.equal(clearsTurnBar(0), false);
});

test("no answer (null, NaN, or a disabled call) is never treated as a yes", () => {
  assert.equal(clearsTurnBar(null), false);
  assert.equal(clearsTurnBar(NaN), false);
});

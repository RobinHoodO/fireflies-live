import { test } from "node:test";
import assert from "node:assert/strict";
import { packSession, unpackSession, shouldAutoResume, SESSION_MAX_AGE_MS } from "./session.ts";

const NOW = 1_800_000_000_000;

test("fresh session round-trips", () => {
  const raw = packSession({ lines: [{ speaker: "You", text: "hi", id: "l1" }], status: "connected" }, NOW);
  const s = unpackSession(raw, NOW + 5_000);
  assert.equal(s.lines[0].text, "hi");
  assert.equal(s.status, "connected");
});

test("stale session is discarded", () => {
  const raw = packSession({ lines: [] }, NOW);
  assert.deepEqual(unpackSession(raw, NOW + SESSION_MAX_AGE_MS + 1), {});
});

test("garbage and absent input give empty session", () => {
  assert.deepEqual(unpackSession(null, NOW), {});
  assert.deepEqual(unpackSession("not json{", NOW), {});
  assert.deepEqual(unpackSession('"a string"', NOW), {});
  assert.deepEqual(unpackSession("[1,2]", NOW), {});
  assert.deepEqual(unpackSession('{"lines":[]}', NOW), {}); // no savedAt
});

test("future-stamped session is discarded", () => {
  const raw = packSession({}, NOW + 3_600_000);
  assert.deepEqual(unpackSession(raw, NOW), {});
});

test("auto-resume only when recent and previously connected", () => {
  const live = { savedAt: NOW, status: "connected", selectedMeeting: { id: "abc" } };
  assert.equal(shouldAutoResume(live, NOW + 60_000), true);
  assert.equal(shouldAutoResume({ ...live, status: "idle" }, NOW + 60_000), false);
  assert.equal(shouldAutoResume({ ...live, selectedMeeting: null }, NOW + 60_000), false);
  assert.equal(shouldAutoResume(live, NOW + 11 * 60_000), false);
});

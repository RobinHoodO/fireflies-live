import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMeetingStore, retentionPolicyFromEnv } from "./meeting-store.mjs";

let dir;
let store;
const now = () => new Date("2026-08-12T10:30:00.000Z");

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "fireflies-meeting-store-"));
  store = createMeetingStore({ recordsDir: dir, now });
});

after(async () => { await rm(dir, { recursive: true, force: true }); });

test("checkpoints are append-only and expose metadata without content", async () => {
  const sessionId = "session-alpha-123";
  await store.checkpoint({ sessionId, sequence: 1, title: "Robin / Max", meetingId: "ff-1", markdown: "# first", ffKey: "must-not-persist", bridgeToken: "also-secret" });
  await store.checkpoint({ sessionId, sequence: 2, title: "Robin / Max", meetingId: "ff-1", markdown: "# complete\n\nfinal line", orKey: "must-not-persist-either" });

  const log = await readFile(store.checkpointFile(sessionId), "utf8");
  const events = log.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => event.sequence), [1, 2]);
  assert.ok(!log.includes("must-not-persist"));

  const interrupted = await store.listInterrupted();
  assert.equal(interrupted.length, 1);
  assert.equal(interrupted[0].sequence, 2);
  assert.equal(interrupted[0].title, "Robin / Max");
  assert.ok(!("markdown" in interrupted[0]));
});

test("recovery atomically finalizes the latest complete checkpoint", async () => {
  const sessionId = "session-alpha-123";
  const result = await store.recover(sessionId);
  assert.equal(result.ok, true);
  assert.equal(result.recovered, true);
  assert.equal(await readFile(result.path, "utf8"), "# complete\n\nfinal line");
  assert.deepEqual(await store.listInterrupted(), []);
  assert.equal((await readdir(dir)).some(file => file.endsWith(".tmp")), false);

  const again = await store.recover(sessionId);
  assert.equal(again.path, result.path, "recovery must be idempotent without a newer checkpoint");
});

test("a checkpoint after manual finalization can produce a more complete final record", async () => {
  const sessionId = "session-beta-456";
  await store.checkpoint({ sessionId, sequence: 1, title: "Ongoing", meetingId: "ff-2", markdown: "# partial" });
  const partial = await store.finalize({ sessionId, title: "Ongoing", meetingId: "ff-2", markdown: "# partial" });
  await store.checkpoint({ sessionId, sequence: 2, title: "Ongoing", meetingId: "ff-2", markdown: "# full\n\nlast words" });
  assert.equal((await store.listInterrupted()).some(item => item.sessionId === sessionId), true);

  const complete = await store.recover(sessionId);
  assert.notEqual(complete.path, partial.path);
  assert.equal(await readFile(complete.path, "utf8"), "# full\n\nlast words");
  assert.equal(await readFile(partial.path, "utf8"), "# partial", "atomic publication never overwrites an earlier final");
});

test("a changed direct finalization cannot be mistaken for a retry", async () => {
  const sessionId = "session-delta-012";
  await store.checkpoint({ sessionId, sequence: 1, title: "Fast stop", meetingId: "ff-4", markdown: "# partial" });
  const partial = await store.finalize({ sessionId, title: "Fast stop", meetingId: "ff-4", markdown: "# partial" });
  const complete = await store.finalize({ sessionId, title: "Fast stop", meetingId: "ff-4", markdown: "# partial\n\nfinal seconds" });
  assert.notEqual(complete.path, partial.path);
  assert.equal(await readFile(complete.path, "utf8"), "# partial\n\nfinal seconds");
  const retry = await store.finalize({ sessionId, title: "Fast stop", meetingId: "ff-4", markdown: "# partial\n\nfinal seconds" });
  assert.equal(retry.path, complete.path);
});

test("recovery chooses the highest sequence when checkpoint requests arrive out of order", async () => {
  const sessionId = "session-gamma-789";
  await store.checkpoint({ sessionId, sequence: 20, title: "Reordered", meetingId: "ff-3", markdown: "# newest" });
  await store.checkpoint({ sessionId, sequence: 19, title: "Reordered", meetingId: "ff-3", markdown: "# stale arrival" });
  const [interrupted] = (await store.listInterrupted()).filter(item => item.sessionId === sessionId);
  assert.equal(interrupted.sequence, 20);
  const recovered = await store.recover(sessionId);
  assert.equal(await readFile(recovered.path, "utf8"), "# newest");
});

test("invalid session ids cannot escape the checkpoint directory", async () => {
  assert.throws(() => store.checkpoint({ sessionId: "../../escape", sequence: 1, title: "x", markdown: "# x" }), /invalid session id/);
});

test("completed records default to Robin's chosen 90-day retention", () => {
  assert.deepEqual(retentionPolicyFromEnv({}), {
    compactTerminalAfterHours: 24,
    terminalJournalRetentionDays: 30,
    finalRecordRetentionDays: 90,
  });
  assert.equal(retentionPolicyFromEnv({ FIREFLIES_FINAL_RETENTION_DAYS: "120" }).finalRecordRetentionDays, 120);
});

test("lifecycle dry-run and compaction preserve every recoverable session", async () => {
  const lifecycleDir = await mkdtemp(path.join(tmpdir(), "fireflies-lifecycle-"));
  let clock = new Date("2026-01-01T00:00:00.000Z");
  const lifecycleStore = createMeetingStore({
    recordsDir: lifecycleDir,
    now: () => clock,
    retentionPolicy: { compactTerminalAfterHours: 1, terminalJournalRetentionDays: 30, finalRecordRetentionDays: 0 },
  });
  try {
    await lifecycleStore.checkpoint({ sessionId: "recoverable-session", sequence: 1, title: "Interrupted", markdown: "# private interrupted transcript" });
    await lifecycleStore.checkpoint({ sessionId: "finalized-session", sequence: 1, title: "Finished", markdown: "# finalized transcript" });
    await lifecycleStore.finalize({ sessionId: "finalized-session", title: "Finished", markdown: "# finalized transcript" });
    clock = new Date("2026-01-03T00:00:00.000Z");

    const preview = await lifecycleStore.runLifecycle();
    assert.deepEqual(preview.recoverablePreserved, ["recoverable-session"]);
    assert.deepEqual(preview.compacted, ["finalized-session.jsonl"]);
    assert.match(await readFile(lifecycleStore.checkpointFile("finalized-session"), "utf8"), /finalized transcript/);

    const applied = await lifecycleStore.runLifecycle({ apply: true });
    assert.deepEqual(applied.recoverablePreserved, ["recoverable-session"]);
    const compacted = await readFile(lifecycleStore.checkpointFile("finalized-session"), "utf8");
    assert.equal(compacted.trim().split("\n").length, 1);
    assert.ok(!compacted.includes("finalized transcript"));
    const [recoverable] = await lifecycleStore.listInterrupted();
    assert.equal(recoverable.sessionId, "recoverable-session");
  } finally { await rm(lifecycleDir, { recursive: true, force: true }); }
});

test("terminal journals and final records are deleted only by explicit positive retention", async () => {
  const lifecycleDir = await mkdtemp(path.join(tmpdir(), "fireflies-retention-"));
  let clock = new Date("2026-01-01T00:00:00.000Z");
  const lifecycleStore = createMeetingStore({ recordsDir: lifecycleDir, now: () => clock });
  try {
    await lifecycleStore.checkpoint({ sessionId: "retained-session", sequence: 1, title: "Retained", markdown: "# retained" });
    const finalized = await lifecycleStore.finalize({ sessionId: "retained-session", title: "Retained", markdown: "# retained" });
    clock = new Date("2026-02-15T00:00:00.000Z");

    const keepFinal = await lifecycleStore.runLifecycle({ apply: true, policy: { compactTerminalAfterHours: 0, terminalJournalRetentionDays: 0, finalRecordRetentionDays: 0 } });
    assert.deepEqual(keepFinal.deletedRecords, []);
    assert.equal(await readFile(finalized.path, "utf8"), "# retained");

    const purge = await lifecycleStore.runLifecycle({ apply: true, policy: { compactTerminalAfterHours: 0, terminalJournalRetentionDays: 0, finalRecordRetentionDays: 30 } });
    assert.deepEqual(purge.deletedRecords, [path.basename(finalized.path)]);
    assert.deepEqual(purge.deletedJournals, ["retained-session.jsonl"]);
    assert.equal((await readdir(lifecycleDir)).includes(path.basename(finalized.path)), false);
    assert.equal((await readdir(path.join(lifecycleDir, ".fireflies-live-checkpoints"))).includes("retained-session.jsonl"), false);
  } finally { await rm(lifecycleDir, { recursive: true, force: true }); }
});

test("90-day completed-record cleanup still preserves an older interrupted session", async () => {
  const lifecycleDir = await mkdtemp(path.join(tmpdir(), "fireflies-90-day-retention-"));
  let clock = new Date("2026-01-01T00:00:00.000Z");
  const lifecycleStore = createMeetingStore({ recordsDir: lifecycleDir, now: () => clock });
  try {
    await lifecycleStore.checkpoint({ sessionId: "old-interrupted-session", sequence: 1, title: "Interrupted", markdown: "# still recoverable" });
    await lifecycleStore.checkpoint({ sessionId: "old-completed-session", sequence: 1, title: "Completed", markdown: "# completed" });
    const finalized = await lifecycleStore.finalize({ sessionId: "old-completed-session", title: "Completed", markdown: "# completed" });
    clock = new Date("2026-04-02T00:00:00.000Z");

    const result = await lifecycleStore.runLifecycle({ apply: true });
    assert.deepEqual(result.deletedRecords, [path.basename(finalized.path)]);
    assert.deepEqual(result.recoverablePreserved, ["old-interrupted-session"]);
    const [recoverable] = await lifecycleStore.listInterrupted();
    assert.equal(recoverable.sessionId, "old-interrupted-session");
    const recovered = await lifecycleStore.recover("old-interrupted-session");
    assert.equal(await readFile(recovered.path, "utf8"), "# still recoverable");
  } finally { await rm(lifecycleDir, { recursive: true, force: true }); }
});

import path from "node:path";
import { link, mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";

const SESSION_ID = /^[A-Za-z0-9_-]{8,96}$/;
const MAX_MARKDOWN_BYTES = 5_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

function boundedNumber(value, fallback, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, max) : fallback;
}

export function retentionPolicyFromEnv(env = process.env) {
  return {
    compactTerminalAfterHours: boundedNumber(env.FIREFLIES_CHECKPOINT_COMPACT_AFTER_HOURS, 24, 24 * 3650),
    terminalJournalRetentionDays: boundedNumber(env.FIREFLIES_CHECKPOINT_RETENTION_DAYS, 30, 3650),
    finalRecordRetentionDays: boundedNumber(env.FIREFLIES_FINAL_RETENTION_DAYS, 90, 3650),
  };
}

function assertSessionId(sessionId) {
  if (!SESSION_ID.test(String(sessionId || ""))) throw new Error("invalid session id");
  return String(sessionId);
}

function cleanText(value, max) {
  return [...String(value || "")].map(char => {
    const code = char.codePointAt(0) || 0;
    return code < 32 || code === 127 ? " " : char;
  }).join("").trim().slice(0, max);
}

function slugify(title) {
  return cleanText(title, 120).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "meeting";
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    // Some filesystems do not support fsync on directories. The file itself is
    // still fsynced; surface all other failures.
    if (error?.code !== "EINVAL" && error?.code !== "ENOTSUP") throw error;
  } finally {
    await handle?.close();
  }
}

async function durableAppend(file, value) {
  const handle = await open(file, "a", 0o600);
  try {
    await handle.write(`${JSON.stringify(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(file));
}

async function durableReplace(file, values) {
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(values.map(value => `${JSON.stringify(value)}\n`).join(""), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, file);
  await syncDirectory(path.dirname(file));
}

async function readEvents(file) {
  let raw = "";
  try { raw = await readFile(file, "utf8"); } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return raw.split("\n").filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

export function createMeetingStore({ recordsDir, now = () => new Date(), retentionPolicy = retentionPolicyFromEnv() }) {
  if (!recordsDir) throw new Error("recordsDir is required");
  const checkpointsDir = path.join(recordsDir, ".fireflies-live-checkpoints");
  const pending = new Map();

  const serialized = (sessionId, operation) => {
    const previous = pending.get(sessionId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    pending.set(sessionId, next);
    next.finally(() => { if (pending.get(sessionId) === next) pending.delete(sessionId); }).catch(() => {});
    return next;
  };

  const checkpointFile = (sessionId) => path.join(checkpointsDir, `${assertSessionId(sessionId)}.jsonl`);

  async function checkpoint({ sessionId, sequence, title, meetingId, markdown }) {
    const id = assertSessionId(sessionId);
    const body = String(markdown || "");
    if (!body.trim()) throw new Error("markdown is required");
    if (Buffer.byteLength(body) > MAX_MARKDOWN_BYTES) throw new Error("checkpoint too large");
    await mkdir(checkpointsDir, { recursive: true, mode: 0o700 });
    const event = {
      v: 1,
      type: "checkpoint",
      sessionId: id,
      sequence: Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : 0,
      recordedAt: now().toISOString(),
      title: cleanText(title, 160) || "Meeting",
      meetingId: cleanText(meetingId, 200),
      markdown: body,
    };
    await durableAppend(checkpointFile(id), event);
    return { ok: true, recordedAt: event.recordedAt, bytes: Buffer.byteLength(body) };
  }

  async function sessionState(sessionId) {
    const events = await readEvents(checkpointFile(sessionId));
    let lastCheckpointIndex = -1;
    let highestSequence = -1;
    events.forEach((event, index) => {
      if (event?.type !== "checkpoint") return;
      const sequence = Number.isSafeInteger(event.sequence) ? event.sequence : 0;
      if (sequence >= highestSequence) { highestSequence = sequence; lastCheckpointIndex = index; }
    });
    const lastCheckpoint = lastCheckpointIndex >= 0 ? events[lastCheckpointIndex] : undefined;
    // A later, higher-sequence checkpoint reopens the append-only session. This
    // preserves the manual "File" button during a live call: a later stop can finalize the
    // more complete record without mutating or overwriting the earlier file.
    const terminal = events.slice(lastCheckpointIndex + 1).findLast(event => event?.type === "finalized" || event?.type === "discarded");
    return { events, lastCheckpoint, terminal };
  }

  async function writeAtomicFinal(title, markdown) {
    await mkdir(recordsDir, { recursive: true, mode: 0o700 });
    const day = now().toISOString().slice(0, 10);
    const stem = `${day}-${slugify(title)}-live`;
    const temp = path.join(recordsDir, `.${stem}.${randomUUID()}.tmp`);
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(markdown, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      for (let suffix = 1; suffix < 10_000; suffix++) {
        const file = path.join(recordsDir, `${stem}${suffix === 1 ? "" : `-${suffix}`}.md`);
        try {
          // A hard link publishes the already-complete temp file atomically and
          // fails rather than overwriting if another finalizer won the name.
          await link(temp, file);
          await unlink(temp);
          await syncDirectory(recordsDir);
          return file;
        } catch (error) {
          if (error?.code !== "EEXIST") throw error;
        }
      }
      throw new Error("could not allocate final meeting filename");
    } catch (error) {
      try { await unlink(temp); } catch { /* best effort temp cleanup */ }
      throw error;
    }
  }

  async function finalize({ sessionId, title, meetingId, markdown }) {
    const id = assertSessionId(sessionId);
    await mkdir(checkpointsDir, { recursive: true, mode: 0o700 });
    const state = await sessionState(id);
    if (!markdown && state.terminal?.type === "finalized") return { ok: true, path: state.terminal.path, recovered: !!state.terminal.recovered };

    const source = String(markdown || state.lastCheckpoint?.markdown || "");
    if (!source.trim()) throw new Error("no meeting content to finalize");
    if (Buffer.byteLength(source) > MAX_MARKDOWN_BYTES) throw new Error("meeting record too large");
    const contentHash = createHash("sha256").update(source).digest("hex");
    if (state.terminal?.type === "finalized" && state.terminal.contentHash === contentHash) {
      return { ok: true, path: state.terminal.path, recovered: !!state.terminal.recovered };
    }
    const resolvedTitle = cleanText(title || state.lastCheckpoint?.title, 160) || "Meeting";
    const resolvedMeetingId = cleanText(meetingId || state.lastCheckpoint?.meetingId, 200);
    const file = await writeAtomicFinal(resolvedTitle, source);
    await durableAppend(checkpointFile(id), {
      v: 1,
      type: "finalized",
      sessionId: id,
      recordedAt: now().toISOString(),
      title: resolvedTitle,
      meetingId: resolvedMeetingId,
      path: file,
      recovered: !markdown,
      contentHash,
    });
    return { ok: true, path: file, recovered: !markdown };
  }

  async function discard(sessionId) {
    const id = assertSessionId(sessionId);
    await mkdir(checkpointsDir, { recursive: true, mode: 0o700 });
    const state = await sessionState(id);
    if (state.terminal) return { ok: true };
    await durableAppend(checkpointFile(id), { v: 1, type: "discarded", sessionId: id, recordedAt: now().toISOString() });
    return { ok: true };
  }

  async function listInterrupted() {
    await mkdir(checkpointsDir, { recursive: true, mode: 0o700 });
    const files = (await readdir(checkpointsDir)).filter(file => file.endsWith(".jsonl"));
    const sessions = [];
    for (const file of files) {
      const id = file.slice(0, -6);
      if (!SESSION_ID.test(id)) continue;
      const state = await sessionState(id);
      if (!state.lastCheckpoint || state.terminal) continue;
      sessions.push({
        sessionId: id,
        title: state.lastCheckpoint.title,
        meetingId: state.lastCheckpoint.meetingId,
        recordedAt: state.lastCheckpoint.recordedAt,
        sequence: state.lastCheckpoint.sequence,
        bytes: Buffer.byteLength(String(state.lastCheckpoint.markdown || "")),
      });
    }
    return sessions.sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
  }

  function safeFinalPath(file) {
    const root = path.resolve(recordsDir);
    const resolved = path.resolve(String(file || ""));
    return resolved.startsWith(`${root}${path.sep}`) && path.dirname(resolved) === root && resolved.endsWith(".md") ? resolved : "";
  }

  async function runLifecycle({ apply = false, policy = retentionPolicy } = {}) {
    await mkdir(checkpointsDir, { recursive: true, mode: 0o700 });
    const effective = {
      compactTerminalAfterHours: boundedNumber(policy?.compactTerminalAfterHours, 24, 24 * 3650),
      terminalJournalRetentionDays: boundedNumber(policy?.terminalJournalRetentionDays, 30, 3650),
      finalRecordRetentionDays: boundedNumber(policy?.finalRecordRetentionDays, 90, 3650),
    };
    const result = { apply, policy: effective, scanned: 0, recoverablePreserved: [], compacted: [], deletedJournals: [], deletedRecords: [] };
    const files = (await readdir(checkpointsDir)).filter(file => file.endsWith(".jsonl"));
    for (const file of files) {
      const id = file.slice(0, -6);
      if (!SESSION_ID.test(id)) continue;
      result.scanned++;
      await serialized(id, async () => {
        const state = await sessionState(id);
        if (!state.terminal) {
          if (state.lastCheckpoint) result.recoverablePreserved.push(id);
          return;
        }
        const recordedAt = Date.parse(state.terminal.recordedAt || "");
        if (!Number.isFinite(recordedAt)) return;
        const ageMs = Math.max(0, now().getTime() - recordedAt);
        const journalExpired = effective.terminalJournalRetentionDays > 0 && ageMs >= effective.terminalJournalRetentionDays * DAY_MS;
        const finalExpired = state.terminal.type === "finalized" && effective.finalRecordRetentionDays > 0 && ageMs >= effective.finalRecordRetentionDays * DAY_MS;
        const finalPath = finalExpired ? safeFinalPath(state.terminal.path) : "";

        if (finalExpired && finalPath) {
          result.deletedRecords.push(path.basename(finalPath));
          if (apply) {
            try { await unlink(finalPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
          }
        }
        if (journalExpired || finalExpired) {
          result.deletedJournals.push(file);
          if (apply) {
            try { await unlink(checkpointFile(id)); } catch (error) { if (error?.code !== "ENOENT") throw error; }
            await syncDirectory(checkpointsDir);
          }
          return;
        }
        const compactAfterMs = effective.compactTerminalAfterHours * 60 * 60 * 1000;
        if (effective.compactTerminalAfterHours > 0 && ageMs >= compactAfterMs && state.events.length > 1) {
          result.compacted.push(file);
          if (apply) await durableReplace(checkpointFile(id), [state.terminal]);
        }
      });
    }
    return result;
  }

  return {
    checkpoint: (value) => serialized(assertSessionId(value?.sessionId), () => checkpoint(value)),
    finalize: (value) => serialized(assertSessionId(value?.sessionId), () => finalize(value)),
    recover: (sessionId) => serialized(assertSessionId(sessionId), () => finalize({ sessionId })),
    discard: (sessionId) => serialized(assertSessionId(sessionId), () => discard(sessionId)),
    listInterrupted,
    runLifecycle,
    checkpointFile,
  };
}

export const __test = { assertSessionId, slugify, readEvents, boundedNumber };

# Plan 017: Rotate the bridge audit log at boot

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 70bc54e..HEAD -- server/bridge.mjs server/bridge.test.mjs`
> If either file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (extends the test harness from plans/002-bridge-guard-tests.md, already landed)
- **Category**: tech-debt
- **Planned at**: commit `70bc54e`, 2026-07-18

## Why this matters

`server/bridge.mjs` appends an audit line for every `/run`, `/pi`, `/context`,
and `/file` request to `server/audit.log` and never truncates or rotates it, so
the file grows without bound for the life of the install. Plan 012 minimized
*what* each line contains (metadata by default) and explicitly deferred
rotation ("Log rotation noted as a deferred follow-up" — `plans/PROGRESS.md`).
A boot-time size check with a single rollover file caps disk growth with ~4
lines of code and zero per-write cost.

## Current state

Relevant files:

- `server/bridge.mjs` — the localhost command bridge. Audit config at lines
  21–24; six `appendFile(AUDIT, …)` call sites (lines 166, 173, 207, 214, 373,
  414). **Security-sensitive file: read the invariants in the root `CLAUDE.md`
  before editing.**
- `server/bridge.test.mjs` — bridge test suite; boots a real bridge in
  `before()` (lines 29–38) with `BRIDGE_AUDIT_FILE` pointed at a temp dir.

`server/bridge.mjs:13-26` today:

```js
import http from "node:http";
import { spawn } from "node:child_process";
import { appendFile, writeFile, readFile, readdir, stat, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const HOST = "127.0.0.1";
const PORT = Number(process.env.BRIDGE_PORT) || 8787;
const AUDIT = process.env.BRIDGE_AUDIT_FILE || path.resolve(process.cwd(), "server", "audit.log");
// Audit metadata only by default — the log otherwise accumulates meeting content
// and operator queries at rest. Opt into body logging for debugging.
const AUDIT_BODIES = process.env.BRIDGE_AUDIT_BODIES === "1";
const MAX_OUTPUT = 200_000; // bytes per run, then truncate
const MAX_MS = 120_000;     // hard timeout per command
```

The bridge test harness boot (`server/bridge.test.mjs:29-38`) — the pattern to
copy for a second, test-local bridge instance:

```js
child = spawn("node", ["server/bridge.mjs"], {
  env: { ...process.env, BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: String(PORT), BRIDGE_FILE_DIR: fileDir, BRIDGE_CLIENTS_ROOT: clientsDir, BRIDGE_AUDIT_FILE: path.join(fileDir, "audit.log") },
});
// …polls GET /health until ready, throws "bridge did not boot" after a deadline
```

Convention: env-overridable knobs in the bridge are all
`const X = process.env.BRIDGE_… || default` at the top of the file — match it.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Bridge tests only | `node --test server/bridge.test.mjs` | all pass |
| Full gate | `npm run verify`                 | lint + tests + typecheck/build all green |

## Scope

**In scope** (the only files you should modify):
- `server/bridge.mjs` (imports + one rotation block near the AUDIT constants)
- `server/bridge.test.mjs` (add one test)

**Out of scope** (do NOT touch, even though they look related):
- The six `appendFile(AUDIT, …)` call sites — per-write rotation is not wanted
  (adds a stat per request for no real benefit; the bridge restarts with every
  `npm run dev`).
- What the audit lines contain (settled by plan 012), auth, denylist, rooting.
- Any external logrotate/launchd machinery.

## Git workflow

- Work directly on `main`; one conventional commit, e.g.
  `feat(bridge): rotate audit log at boot when it exceeds BRIDGE_AUDIT_MAX_BYTES (plan 017)`.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Add boot-time rotation

In `server/bridge.mjs`, extend the `node:fs` import (line 16) with the two sync
functions, and add the rotation right after the `AUDIT_BODIES` line (24):

```js
import { existsSync, statSync, renameSync } from "node:fs";
```

```js
// Rotate at boot: one .1 rollover caps disk growth (bridge restarts with every
// dev-server boot, so boot-time-only is enough; no per-write stat cost).
const AUDIT_MAX = Number(process.env.BRIDGE_AUDIT_MAX_BYTES) || 5_000_000;
try { if (statSync(AUDIT).size > AUDIT_MAX) renameSync(AUDIT, `${AUDIT}.1`); } catch { /* no log yet */ }
```

Notes: `renameSync` onto an existing `.1` replaces it (POSIX rename) — one
generation of history is the deliberate ceiling. Sync at module top-level is
fine; it runs once before the server binds.

**Verify**: `node --test server/bridge.test.mjs` → all existing tests still
pass (their audit file is small, so no rotation triggers).

### Step 2: Prove it with a test

Add to `server/bridge.test.mjs` (near the existing audit-log test at line 188).
This test boots its **own** bridge instance on a different port with a tiny
`BRIDGE_AUDIT_MAX_BYTES` and a pre-filled log, modeled on the `before()` boot
block quoted above:

```js
test("oversized audit log rotates to .1 at boot", async () => {
  const auditPath = path.join(fileDir, "rotate-audit.log");
  await writeFile(auditPath, "x".repeat(200) + "\n");
  const port2 = PORT + 1;
  const c2 = spawn("node", ["server/bridge.mjs"], {
    env: { ...process.env, BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: String(port2), BRIDGE_FILE_DIR: fileDir, BRIDGE_CLIENTS_ROOT: clientsDir, BRIDGE_AUDIT_FILE: auditPath, BRIDGE_AUDIT_MAX_BYTES: "100" },
  });
  try {
    let ready = false;
    for (let i = 0; i < 50 && !ready; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try { const r = await fetch(`http://127.0.0.1:${port2}/health`); ready = r.ok; } catch {}
    }
    assert.ok(ready, "rotation-test bridge did not boot");
    const rolled = await readFile(`${auditPath}.1`, "utf8");
    assert.ok(rolled.startsWith("xxx"), "old log content should be in the .1 rollover");
    assert.ok(!existsSync(auditPath) || (await readFile(auditPath, "utf8")).length < 100, "fresh log should be empty or tiny");
  } finally { c2.kill("SIGKILL"); }
});
```

Adjust names/imports to what the file actually uses (`writeFile`, `readFile`,
`existsSync`, `spawn` — most are already imported; add any that aren't). If the
harness's port constant isn't literally `PORT`, use the file's actual name.

**Verify**: `node --test server/bridge.test.mjs` → all pass including the new
test.

### Step 3: Full gate

**Verify**: `npm run verify` → green.

## Test plan

- New test "oversized audit log rotates to .1 at boot" (Step 2), modeled on the
  suite's own `before()` boot pattern.
- Implicit regression coverage: the existing audit-metadata test (line 188)
  still passes, proving small logs are untouched.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node --test server/bridge.test.mjs` exits 0, including the rotation test
- [ ] `npm run verify` exits 0
- [ ] `grep -n "AUDIT_MAX" server/bridge.mjs` → 2 matches (definition + check)
- [ ] `git status` shows only the two in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Lines 13–26 of `server/bridge.mjs` don't match the excerpt above.
- The rotation-test bridge fails to boot twice in a row (port collision with a
  running dev bridge is possible — try a different `port2` offset once, then
  stop and report).
- Any pre-existing bridge test starts failing.

## Maintenance notes

- Ceiling by design: one `.1` generation, rotation only at boot. A bridge left
  running for weeks under heavy use could exceed `BRIDGE_AUDIT_MAX_BYTES`
  between boots; if that ever matters, move the size check into a small
  wrapper around the six `appendFile` call sites — don't add a timer.
- `BRIDGE_AUDIT_MAX_BYTES` joins the bridge's env-knob family
  (`BRIDGE_AUDIT_FILE`, `BRIDGE_AUDIT_BODIES`, …); if a bridge env-var table is
  ever added to docs, include it.

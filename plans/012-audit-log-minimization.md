# Plan 012: Minimize what the bridge audit log persists to disk

> **Executor instructions**: Follow step by step; run every verification command.
> On a STOP condition, stop and report. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 43c51bd..HEAD -- server/bridge.mjs`. Mismatch = STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/002-bridge-guard-tests.md (so audit-line format changes don't silently break)
- **Category**: security
- **Planned at**: commit `43c51bd`, 2026-07-14

## Why this matters

`server/audit.log` accumulates third-party meeting content and operator queries in
plaintext with no rotation or retention limit: PI messages (`message.slice(0,200)`),
context counterpart/topic, full `/run` commands, filed filenames. The file is
correctly gitignored (no commit leak), but it's a growing at-rest store of
potentially confidential deal/PII data — a separate surface from the documented
OpenRouter "privacy ceiling." This plan reduces logged content to metadata by
default and makes body logging opt-in.

## Current state (`server/bridge.mjs`)

- `:160` — `RUN ${cmd}` (full command).
- `:190` — `PI ${sessionId} ${message.slice(0,200)...}` (message body).
- `:332` — `CTX ${counterpart} | ${(topic||goal).slice(0,60)} | sources=...` (query content).
- `:373` — `FILE ${filename} (${bytes} bytes)` (filename only — this one is already metadata; fine).
- Denylist blocks also log the command (`:153`, and the `/pi` block from plan 004).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Syntax | `node --check server/bridge.mjs` | exit 0 |
| Bridge tests | `node --test server/bridge.test.mjs` | all pass |
| Verify | `npm run verify` | exit 0 |

## Scope

**In scope**: `server/bridge.mjs` audit-log lines only; `server/bridge.test.mjs`
if any test asserts on log content (update it).
**Out of scope**: the guard logic, response bodies, log rotation infrastructure
(a size-capped rotation is a nice-to-have but out of this plan's scope — note it).

## Steps

### Step 1: Gate body logging behind an env flag

Add near the top-of-file constants:
```js
const AUDIT_BODIES = process.env.BRIDGE_AUDIT_BODIES === "1"; // opt-in content logging
```

### Step 2: Log metadata by default, bodies only when opted in

- `/run` (`:160`): default log `RUN <bytelength> bytes` + a short hash or first
  token; log the full `cmd` only when `AUDIT_BODIES`. Denylist blocks (`:153`)
  may keep logging the blocked command's *pattern name* (`bad`) but gate the raw
  command behind `AUDIT_BODIES`.
- `/pi` (`:190`): default `PI <sessionId> <bytelength> bytes`; full message only
  when `AUDIT_BODIES`.
- `/context` (`:332`): default `CTX sources=...` (keep the source-kind:count
  summary — that's operational, not content); gate the raw counterpart/topic
  strings behind `AUDIT_BODIES`.
- `/file` (`:373`): unchanged (already metadata).

Keep every audit line's leading ISO timestamp and event tag so existing log
parsing (if any) still works.

**Verify**: `node --check server/bridge.mjs` → exit 0.

### Step 3: Update/extend tests

If any plan-002 test asserts on audit-log content, update it. Optionally add a
test that with `BRIDGE_AUDIT_BODIES` unset, a `/run` of a benign command does not
write the raw command text to the audit file (point `AUDIT` at a temp path via an
env override if one exists; if `AUDIT`'s path isn't overridable, add a
`BRIDGE_AUDIT_FILE` env fallback on line 21 — that single-line change is in scope).

**Verify**: `node --test server/bridge.test.mjs` → all pass.

## Done criteria

- [ ] By default, `/run`/`/pi`/`/context` audit lines log metadata (byte counts,
      session id, source summary), not raw command/message/query bodies
- [ ] `BRIDGE_AUDIT_BODIES=1` restores full body logging for debugging
- [ ] Existing bridge tests still pass; any content assertions updated
- [ ] `npm run verify` exits 0
- [ ] `plans/README.md` status row for 012 updated

## STOP conditions

- A test asserts on a log body that this change removes and it's unclear whether
  the assertion or the change should win — report; don't guess.

## Maintenance notes

- A follow-up worth considering (not in scope): size-capped log rotation and a
  documented retention window. Note it in the roadmap's "Known follow-ups."
- Keep the source-count summary in `/context` logs — it's how the operator
  verifies retrieval worked, and it carries no meeting content.

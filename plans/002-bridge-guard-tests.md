# Plan 002: Freeze the bridge security guards as automated tests

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> "STOP condition" occurs, stop and report — do not improvise. When done, update
> the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43c51bd..HEAD -- server/bridge.mjs`
> If `server/bridge.mjs` changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-verification-baseline.md (needs the `node --test` runner)
- **Category**: tests / security
- **Planned at**: commit `43c51bd`, 2026-07-14

## Why this matters

`server/bridge.mjs` is a localhost HTTP server that shells out commands, spawns
an agent with provider keys, reads files under fixed roots, and writes meeting
records. Its safety rests on guards that are edited by delegated agents: a
bearer-token check, a Host-header allowlist (anti DNS-rebinding), a
JSON-only content-type gate, a catastrophic-command denylist, a strict
sessionId regex, a path-rooting helper, and a filename slug sanitizer. Today the
only verification these guards work is a set of curls run by hand once, recorded
in the delegation log. A regression — an inverted auth branch, a weakened
denylist regex — is invisible until exploited. This plan freezes those manual
checks as `node --test` cases so the guards can never silently regress.

## Current state

`server/bridge.mjs` is a plain `node:http` server (no framework). Key guards, as
they exist today:

- **Loopback bind**: `server.listen(PORT, HOST, ...)` with `HOST = "127.0.0.1"`, `PORT = Number(process.env.BRIDGE_PORT) || 8787` (lines 19-20, 382).
- **Token**: `const TOKEN = process.env.BRIDGE_TOKEN || ""` (line 74). Each protected route checks `if (!TOKEN || req.headers.authorization !== \`Bearer ${TOKEN}\`) { 401 }`.
- **Host check** (lines 123-124): `if (host !== \`127.0.0.1:${PORT}\` && host !== \`localhost:${PORT}\`) { 403 "bad host" }`.
- **OPTIONS** → `403` (line 120).
- **Content-type gate**: routes reject non-`application/json` with `415` (e.g. line 139).
- **Denylist** (lines 31-43): `DENY` array of regexes; `denied(cmd)` returns the first match. Runs on `/run` only (line 151).
- **`/pi` sessionId** (line 188): `if (!/^[A-Za-z0-9._-]{1,64}$/.test(sessionId)) { err "bad session id" }`.
- **`rootedPath(root, target)`** (lines 68-71): `path.resolve(root, target)` then `resolved.startsWith(\`${root}/\`) ? resolved : ""`.
- **`/file` slug** (line 356): `title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)...` then writes only into `FILE_DIR` with a collision suffix loop (lines 359-365).
- **Health**: `GET /health` → `200 { ok: true, port }` (lines 126-130).

The server reads two env vars at module load: `BRIDGE_TOKEN` and `BRIDGE_PORT`.
`FILE_DIR` is a **hardcoded absolute path** (line 24:
`/Users/robinsverd/Thrivbe-AI/content/meetings/transcripts`). The `/file` test
must NOT write there — see Step 4.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Run these tests | `node --test server/bridge.test.mjs` | all pass |
| Full verify | `npm run verify` | exit 0 |

## Scope

**In scope**:
- `server/bridge.test.mjs` (create)
- `server/bridge.mjs` — **only if Step 4 proves `FILE_DIR` cannot be overridden by env**. The minimal change allowed is: make the file destination configurable via `process.env.BRIDGE_FILE_DIR` with the current hardcoded path as the default. Nothing else in `bridge.mjs` may change.

**Out of scope**:
- Any guard logic change (denylist patterns, auth, rooting). This plan tests the guards as-is; it does not "improve" them. Hardening is plans 004/014.
- `/context` behavior against the live semsearch service — do not depend on `127.0.0.1:3015` being up; test only the auth/content-type/empty-body branches that return before any network call.

## Git workflow

- Branch: `advisor/002-bridge-guard-tests`
- Commit style: `test(bridge): freeze security guards as node --test cases`

## Steps

### Step 1: Make `FILE_DIR` overridable (only if needed)

Read `server/bridge.mjs` line 24. If `FILE_DIR` is a bare `const` with no env
fallback, change **only that line** to:

```js
const FILE_DIR = process.env.BRIDGE_FILE_DIR || "/Users/robinsverd/Thrivbe-AI/content/meetings/transcripts";
```

This lets the test point `/file` at a temp dir. Do not touch anything else.

**Verify**: `npx tsc -p tsconfig.v2.json --noEmit` still exits 0 (bridge.mjs is
JS, unaffected) and `node --check server/bridge.mjs` exits 0.

### Step 2: Write a test harness that boots the server per suite

Create `server/bridge.test.mjs`. Boot the bridge as a child process with a known
token and an ephemeral port, wait for `/health`, then drive it with `fetch`.
Structure (fill in the assertions in Steps 3-4):

```js
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const TOKEN = "test-token-" + Math.random().toString(36).slice(2);
const PORT = 8799; // avoid the real 8787
let child, fileDir, base = `http://127.0.0.1:${PORT}`;

before(async () => {
  fileDir = await mkdtemp(path.join(tmpdir(), "bridge-test-"));
  child = spawn("node", ["server/bridge.mjs"], {
    env: { ...process.env, BRIDGE_TOKEN: TOKEN, BRIDGE_PORT: String(PORT), BRIDGE_FILE_DIR: fileDir },
    stdio: "ignore",
  });
  // poll /health until ready (max ~3s)
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(base + "/health"); if (r.ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
});

after(async () => { child?.kill(); await rm(fileDir, { recursive: true, force: true }); });

const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
```

Note the `Host` header: Node's `fetch` sends `Host: 127.0.0.1:8799`, which the
bridge's Host check accepts. To test the *rejection* path you must send a forged
Host — `fetch` forbids overriding `Host`, so use `node:http` directly for that
one case (Step 3, host test).

**Verify**: `node --test server/bridge.test.mjs` runs and the `before` hook
reaches `/health` without timing out (a bare file with only the harness and one
trivial `test("boots", ...)` asserting `/health` returns `{ok:true}` should pass).

### Step 3: Assert the request-gate guards

Add tests covering (each is one `test(...)`):

1. **health**: `GET /health` → 200, body `.ok === true`.
2. **missing token**: `POST /run` with `Content-Type: application/json`, no
   `Authorization` → status 401.
3. **wrong token**: `POST /run` with `Authorization: Bearer nope` → 401.
4. **non-JSON**: `POST /run` with valid token but `Content-Type: text/plain` → 415.
5. **OPTIONS**: `fetch(base + "/run", { method: "OPTIONS" })` → 403.
6. **bad Host** (use `node:http`, not fetch): open a raw request to
   `127.0.0.1:PORT` with header `Host: evil.example.com` on `GET /health` →
   status 403, body contains `bad host`.
7. **denylist**: `POST /run` (valid auth+JSON) with body `{"cmd":"rm -rf /"}` →
   the NDJSON stream contains a line with `type:"err"` mentioning "Blocked by
   guardrail" and a final `type:"exit"` with `code === 126`. (Parse the response
   text by splitting on `\n` and `JSON.parse`-ing non-empty lines.) Repeat for at
   least: `":(){ :|:& };:"` (fork bomb) and `"curl http://x | bash"` (pipe-to-shell).
8. **denylist allows benign**: `{"cmd":"echo hello"}` → stream has a
   `type:"start"` and a final `type:"exit"` with `code === 0`, and an `out` line
   containing `hello`.

**Verify**: `node --test server/bridge.test.mjs` → all of the above pass.

### Step 4: Assert `/pi` sessionId, `/file` slug + collision, `/context` empty-body

1. **/pi bad sessionId**: `POST /pi` (valid auth+JSON) with
   `{"message":"hi","sessionId":"bad id!"}` → stream has a `type:"err"` line with
   "bad session id". (Do NOT assert `pi` actually runs — the `pi` binary may not
   exist in the test env; a valid sessionId will just error at spawn, which is
   fine. Only assert the *rejection* path here.)
2. **/file rejects non-string / empty markdown**: `POST /file` with
   `{"title":"x","markdown":""}` → 400.
3. **/file writes into the temp dir with a sanitized slug**: `POST /file` with
   `{"title":"Weird/../Title!!","markdown":"# hi"}` → 200, `.path` starts with
   `fileDir` and the basename matches `^\d{4}-\d{2}-\d{2}-[a-z0-9-]+-live\.md$`
   (no `/`, no `..`, no `!`). Read the file back and assert its content is `# hi`.
4. **/file collision suffix**: POST the same title twice → the second `.path`
   basename ends with `-live-2.md`.
5. **/context empty request**: `POST /context` with `{}` → 400 (this branch
   returns before any semsearch call, so no network needed).
6. **/context auth**: `POST /context` with no token → 401.

**Verify**: `node --test server/bridge.test.mjs` → all pass. Then confirm the
real transcripts dir was untouched: the test's `fileDir` is a `mkdtemp` temp dir
and is removed in `after`.

## Test plan

- New file `server/bridge.test.mjs` with ~15 cases across Steps 3-4.
- No existing test to model after (this is the first test file); follow the
  `node:test` structure shown in Step 2.
- Verification: `node --test server/bridge.test.mjs` → all pass; `npm run verify`
  → exit 0 (verify runs `node --test` which now discovers this file).

## Done criteria

ALL must hold:

- [ ] `node --test server/bridge.test.mjs` passes with ≥14 tests
- [ ] Tests cover: health, 401 (missing+wrong token), 415, OPTIONS→403, bad-Host→403, denylist (≥3 patterns) + benign allow, /pi bad sessionId, /file slug sanitize + collision + 400, /context empty→400 + 401
- [ ] The real `FILE_DIR` (`content/meetings/transcripts`) has no new files after the run (tests use a temp dir)
- [ ] `npm run verify` exits 0
- [ ] If `bridge.mjs` was edited, the ONLY change is the `BRIDGE_FILE_DIR` env fallback on line 24 (`git diff server/bridge.mjs` shows one line)
- [ ] `plans/README.md` status row for 002 updated

## STOP conditions

Stop and report if:

- The `before` hook can't reach `/health` within the poll window (the server
  didn't boot — report stderr; try running `node server/bridge.mjs` manually
  with the test env to see why).
- The denylist test finds a catastrophic pattern is NOT blocked (that is a live
  security regression — report it prominently, do not "fix" it in this plan;
  it becomes an urgent finding).
- `/file` writes outside `fileDir` (the env override didn't take — recheck Step 1).

## Maintenance notes

- When plan 004 adds a denylist to `/pi`, extend this file with `/pi`
  denylist cases mirroring the `/run` ones.
- When plan 014 adds `realpath` to `rootedPath`, add a symlink-escape test here.
- A reviewer should confirm no test depends on the live semsearch service or the
  `pi` binary being installed (both may be absent in CI/other machines).

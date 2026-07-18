# Plan 016: Kill bridge children on client disconnect; abort superseded PI streams

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 70bc54e..HEAD -- server/bridge.mjs server/bridge.test.mjs v2/App.tsx v2/backend.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW–MED (touches the shared child-streaming path used by /run and /pi)
- **Depends on**: none (extends the test harness from plans/002-bridge-guard-tests.md, already landed)
- **Category**: bug / perf
- **Planned at**: commit `70bc54e`, 2026-07-18

## Why this matters

When the browser aborts a `/run` or `/pi` request (tab close, fetch abort,
navigation), the bridge keeps the spawned child process running until it exits
on its own or hits the 120-second hard timeout — output is streamed into a dead
socket the whole time. For `/pi` that's an orphaned `pi` LLM process burning
provider tokens for up to two minutes per abandoned request. On the client
side, PI streams are never aborted at all: `streamPI` has had an `AbortSignal`
parameter since plan 007, but `v2/App.tsx` passes nothing, so a superseded or
unmounted PI stream keeps consuming its response forever. This plan closes both
ends: the bridge kills the child when the response socket closes, and the UI
aborts the previous PI stream when a new one starts (and on unmount). This was
deferred from plan 007 ("PI-stream supersede-abort wiring") and is recorded in
`plans/PROGRESS.md`.

## Current state

Relevant files:

- `server/bridge.mjs` — localhost command bridge. `streamChild` (lines 112–126)
  streams a spawned child to the NDJSON response; shared by `/run` (line 178)
  and `/pi` (line 217). **Security-sensitive: read the invariants in the root
  `CLAUDE.md` before editing.**
- `server/bridge.test.mjs` — 25 tests freezing bridge behavior; boots a real
  bridge on an ephemeral port in `before()` (lines 29–38). New test goes here.
- `v2/App.tsx` — `sendPI` (lines 505–521) calls `streamPI` with no signal.
  The existing abort pattern for live answers is at lines 163 + 345–361.
- `v2/backend.ts` — `streamPI` (lines 267–277) already accepts
  `signal?: AbortSignal` and passes it to `fetch`. **No change needed here.**

`server/bridge.mjs:112-126` today:

```js
// Stream a spawned child's stdout/stderr/exit to the NDJSON response, with an output
// cap and hard timeout. Shared by /run and /pi.
function streamChild(res, child) {
  let bytes = 0, killed = false;
  const cap = (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_OUTPUT && !killed) { killed = true; child.kill("SIGKILL"); return "\n[output truncated]\n"; }
    return chunk.toString();
  };
  const timer = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, MAX_MS);
  child.stdout.on("data", (c) => { if (!killed) send(res, { type: "out", data: cap(c) }); });
  child.stderr.on("data", (c) => { if (!killed) send(res, { type: "err", data: cap(c) }); });
  child.on("close", (code) => { clearTimeout(timer); send(res, { type: "exit", code: killed ? 137 : code }); res.end(); });
  child.on("error", (e) => { clearTimeout(timer); send(res, { type: "err", data: String(e.message) }); send(res, { type: "exit", code: 1 }); res.end(); });
}
```

`v2/App.tsx:505-521` today (`sendPI`):

```tsx
const sendPI = async (text: string) => {
  const t = text.trim(); if (!t) return;
  setTab("pi");
  const uid = Date.now();
  setPiMessages(prev => [...prev, { id: uid, role: "user", text: t }]);
  if (!bridgeOnline) { setPiMessages(prev => [...prev, { id: uid + 1, role: "agent", text: "⚠ PI bridge offline — is the dev server running?" }]); return; }
  setPiThinking(true);
  const aid = uid + 1; let started = false;
  try {
    await streamPI(t, piSessionRef.current, bridgeToken, partial => {
      if (!started) { started = true; setPiThinking(false); setPiMessages(prev => [...prev, { id: aid, role: "agent", text: partial }]); }
      else setPiMessages(prev => prev.map(m => m.id === aid ? { ...m, text: partial } : m));
    });
  } catch { setPiMessages(prev => [...prev, { id: aid, role: "agent", text: "⚠ PI unreachable." }]); }
  if (!started) setPiMessages(prev => [...prev, { id: aid, role: "agent", text: "_(no output)_" }]);
  setPiThinking(false);
};
```

The pattern to mirror for aborting — `v2/App.tsx:163` and `v2/App.tsx:345-361`
(live-answer streams): a `useRef<AbortController | null>`, `abort()` on the
previous controller before starting a new stream, and an unmount-only effect
`useEffect(() => () => ref.current?.abort(), [])`.

Conventions: v2 uses inline-style objects and compact single-file React — match
it. The bridge test file uses `node:test` + `assert` with a single shared
server booted in `before()`; each test is a plain `test("name", async () => …)`.

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Bridge tests only | `node --test server/bridge.test.mjs` | all pass |
| Full gate | `npm run verify`                 | lint + tests + typecheck/build all green |

## Scope

**In scope** (the only files you should modify):
- `server/bridge.mjs` (only `streamChild`)
- `server/bridge.test.mjs` (add one test)
- `v2/App.tsx` (only the PI section: a new ref + `sendPI` + one unmount effect)

**Out of scope** (do NOT touch, even though they look related):
- `v2/backend.ts` — `streamPI` already has the signal seam; no change.
- The `/run` UI path and the answer/nav/sentiment/agenda pulse code in
  `v2/App.tsx` — the live-answer abort discipline there is done (plan 007).
- The denylist, auth, Host-check, or audit-log code in `bridge.mjs`.
- Process-group killing (`detached: true` + `kill(-pid)`): with `shell: true`,
  grandchildren of a killed shell can survive. That is pre-existing behavior of
  the timeout/cap kills too — leave it; see Maintenance notes.

## Git workflow

- Work directly on `main` (repo convention from plans 001–015: one conventional
  commit per plan, e.g. `fix(bridge): kill children on client disconnect; abort superseded PI streams (plan 016)`).
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Kill the child when the response socket closes

In `server/bridge.mjs` `streamChild`, add an `exited` flag and a `res.on("close")`
handler. Target shape:

```js
function streamChild(res, child) {
  let bytes = 0, killed = false, exited = false;
  const cap = (chunk) => { /* unchanged */ };
  const timer = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, MAX_MS);
  // Client gone (fetch aborted, tab closed): stop the child instead of streaming
  // into a dead socket for up to MAX_MS.
  res.on("close", () => { if (!exited && !killed) { killed = true; clearTimeout(timer); child.kill("SIGKILL"); } });
  child.stdout.on("data", (c) => { if (!killed) send(res, { type: "out", data: cap(c) }); });
  child.stderr.on("data", (c) => { if (!killed) send(res, { type: "err", data: cap(c) }); });
  child.on("close", (code) => { exited = true; clearTimeout(timer); send(res, { type: "exit", code: killed ? 137 : code }); res.end(); });
  child.on("error", (e) => { exited = true; clearTimeout(timer); send(res, { type: "err", data: String(e.message) }); send(res, { type: "exit", code: 1 }); res.end(); });
}
```

Notes: Node fires `res` `"close"` after a normal `res.end()` too — that's why
the `exited` guard exists. `send`/`res.end()` on a closed socket are no-ops in
Node's http, so the `child.on("close")` handler needs no extra guarding.

**Verify**: `node --test server/bridge.test.mjs` → all existing tests still pass.

### Step 2: Prove it with a test

Add to `server/bridge.test.mjs` (after the audit-log test, before the
`/context` block):

```js
test("client abort kills the running child", async () => {
  const pidFile = path.join(fileDir, "abort-pid.txt");
  const ac = new AbortController();
  const p = fetch(`http://127.0.0.1:${PORT}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ cmd: `echo $$ > '${pidFile}'; exec sleep 30` }),
    signal: ac.signal,
  });
  // Wait for the child to write its pid, then abort the request.
  let pid = 0;
  for (let i = 0; i < 50 && !pid; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try { pid = Number((await readFile(pidFile, "utf8")).trim()); } catch {}
  }
  assert.ok(pid > 0, "child never started");
  ac.abort();
  await p.catch(() => {}); // the aborted fetch rejects; that's expected
  // Give the bridge a moment to react, then the pid must be gone.
  let alive = true;
  for (let i = 0; i < 30 && alive; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try { process.kill(pid, 0); } catch { alive = false; }
  }
  assert.equal(alive, false, `child ${pid} still running after client abort`);
});
```

Why `echo $$ > file; exec sleep 30`: with `shell: true` the spawned process is
the shell; `$$` is its pid and `exec` replaces the shell with `sleep` at the
**same pid**, so killing the direct child provably kills the sleeper. Reuse the
existing imports (`readFile` is already imported in the test file — check; add
it to the `node:fs/promises` import if not).

**Verify**: `node --test server/bridge.test.mjs` → all pass including the new
test. Run it twice to check it isn't flaky.

### Step 3: Abort superseded / unmounted PI streams in the UI

In `v2/App.tsx`:

1. Next to `answerAbortRef` (line 163), add:
   `const piAbortRef = useRef<AbortController | null>(null);`
2. Next to the unmount-abort effect (line 349), add:
   `useEffect(() => () => piAbortRef.current?.abort(), []);`
3. In `sendPI`, after the `bridgeOnline` guard: abort the previous controller,
   create a new one, pass its signal to `streamPI`, and make the error paths
   abort-aware:

```tsx
setPiThinking(true);
const aid = uid + 1; let started = false;
piAbortRef.current?.abort(); // supersede: stop the previous stream's child + network work
const controller = new AbortController();
piAbortRef.current = controller;
try {
  await streamPI(t, piSessionRef.current, bridgeToken, partial => {
    if (!started) { started = true; setPiThinking(false); setPiMessages(prev => [...prev, { id: aid, role: "agent", text: partial }]); }
    else setPiMessages(prev => prev.map(m => m.id === aid ? { ...m, text: partial } : m));
  }, controller.signal);
} catch { if (!controller.signal.aborted) setPiMessages(prev => [...prev, { id: aid, role: "agent", text: "⚠ PI unreachable." }]); }
if (!started && !controller.signal.aborted) setPiMessages(prev => [...prev, { id: aid, role: "agent", text: "_(no output)_" }]);
setPiThinking(false);
```

The two `controller.signal.aborted` guards are load-bearing: without them, the
*superseded* call's own catch/no-output paths would append "⚠ PI unreachable."
or "_(no output)_" into the chat every time a new message supersedes an
in-flight one.

**Verify**: `npm run verify` → green (lint, 38+ tests, v2 typecheck + build).

## Test plan

- New test in `server/bridge.test.mjs`: "client abort kills the running child"
  (Step 2) — models the fetch/harness style of the existing denylist tests.
- The UI change is covered by typecheck + the pattern's prior art; no component
  test harness exists in this repo (all v2 tests are pure helpers), so do not
  invent one.
- Verification: `npm run verify` → all pass, one more test than before.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node --test server/bridge.test.mjs` exits 0, including the new abort test
- [ ] `npm run verify` exits 0
- [ ] `grep -n 'res.on("close"' server/bridge.mjs` → one match inside `streamChild`
- [ ] `grep -n "piAbortRef" v2/App.tsx` → ≥3 matches (declaration, unmount effect, sendPI)
- [ ] `git status` shows only the three in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `streamChild` or `sendPI` no longer match the "Current state" excerpts.
- The new bridge test is flaky (fails on any of 3 consecutive runs) — the
  pid-poll timing may need different constants; report rather than loosening
  the assertion.
- The fix appears to require touching `v2/backend.ts` or the bridge's auth/
  denylist code.
- Any pre-existing bridge test starts failing.

## Maintenance notes

- Killing the direct child does not kill grandchildren of `shell: true`
  commands (e.g. `a | b` pipelines may leave `b`). Same limitation as the
  existing timeout/output-cap kills. If that ever matters, the upgrade is
  `detached: true` + `process.kill(-child.pid, "SIGKILL")` in ALL three kill
  sites at once — do not fix it only for the disconnect path.
- If a "stop generating" button is ever added to the PI tab, wire it to
  `piAbortRef.current?.abort()` — the plumbing from this plan is all it needs.
- Reviewer: check the `exited` flag ordering (`child.on("close")` sets it
  before `res.end()` triggers `res` `"close"`).

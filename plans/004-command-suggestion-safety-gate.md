# Plan 004: Gate transcript-derived shell commands before they reach the PI agent

> **Executor instructions**: Follow step by step; run every verification command.
> On a STOP condition, stop and report. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 43c51bd..HEAD -- v2/App.tsx v2/backend.ts server/bridge.mjs`
> On any change to these, compare the "Current state" excerpts against live code;
> mismatch = STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/002-bridge-guard-tests.md (extend its `/pi` test coverage)
- **Category**: security
- **Planned at**: commit `43c51bd`, 2026-07-14

## Why this matters

The AI suggestion pulse can emit a `"command"` suggestion whose text is "a single
runnable command", derived from the **live meeting transcript** — i.e. from words
spoken by untrusted third parties on the call. In v2 a `command` suggestion is
rendered as a clickable chip and, on one operator click, sent straight to the
`/pi` endpoint, which spawns an agent with `read · bash · edit · write` tools and
provider keys. Two gaps compound: (1) the click is the *only* gate — there is no
preview/confirm step (the legacy v1 app had one); (2) the `/pi` endpoint has **no
denylist**, while `/run` does. So a meeting participant who says the right words
can get an attacker-chosen command surfaced as a friendly suggestion that
executes on one click, with less protection than the manual terminal path. This
plan adds a confirm-and-preview step before any transcript-derived command runs,
and applies the existing denylist to `/pi`.

## Current state

- Suggestion prompt authorizes commands — `v2/backend.ts:142` (system prompt):
  `"command" (an exact shell command to run on Robin's machine — for this type "text" MUST be a single runnable command with no prose)`.
- Routing on click — `v2/App.tsx` (~line 470):
  ```ts
  const handleSuggestion = (s: Suggestion) => {
    if (s.type === "command") sendPI(s.text);
    else askChat(s.text);
  };
  ```
  `sendPI` (line ~450) immediately POSTs to `/bridge/pi` and streams output.
- The feed chip that triggers it — `v2/App.tsx` (~line 813-825): each suggestion
  is a `<button onClick={() => handleSuggestion(s)} ...>`.
- Bridge `/pi` — `server/bridge.mjs:173-194`: token + JSON + sessionId checks,
  then `spawn("pi", ["--print","--offline","--session-id", sessionId, message], ...)`.
  **No `denied()` call** (contrast `/run` at line 151).
- The denylist helper — `server/bridge.mjs:41-43`: `denied(cmd)` returns the
  first matching `DENY` regex or `undefined`.

The app uses inline-style objects everywhere (design-port convention) and small
local `useState` for transient UI — see the existing `filed`/`copied` confirm
patterns (`v2/App.tsx:140-141`) for the idiom to match.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Typecheck | `npm run typecheck:v2` | exit 0 |
| Bridge tests | `node --test server/bridge.test.mjs` | all pass |
| Full verify | `npm run verify` | exit 0 |
| Live check | `npm run dev:v2` then drive demo mode in a browser | confirm dialog appears before a command runs |

## Scope

**In scope**:
- `v2/App.tsx` — add a pending-command confirm state + a small confirm bar/dialog; route `command` suggestions through it instead of calling `sendPI` directly.
- `server/bridge.mjs` — apply `denied()` to the `/pi` message path (mirror `/run`).
- `server/bridge.test.mjs` — add `/pi` denylist cases (this file exists after plan 002).

**Out of scope**:
- The `/run` path (already gated).
- Removing the `command` suggestion type or changing the suggestion prompt — the
  capability stays; only its execution is gated.
- Any redesign of the PI panel beyond the confirm affordance.

## Steps

### Step 1: Add a denylist check to `/pi` in `server/bridge.mjs`

In the `/pi` handler (after the sessionId validation at line 188, before the
`spawn`), add:

```js
const bad = denied(message);
if (bad) {
  await appendFile(AUDIT, `${new Date().toISOString()} PI-BLOCKED ${sessionId} ${message.slice(0,120).replace(/\n/g," ")}\n`).catch(() => {});
  send(res, { type: "err", data: `Blocked by guardrail (${bad}). Refused.` });
  send(res, { type: "exit", code: 126 });
  res.end();
  return;
}
```

Place it so a blocked message never reaches `spawn`. Keep the existing audit-log
`PI` line for allowed messages.

**Verify**: `node --check server/bridge.mjs` → exit 0.

### Step 2: Add `/pi` denylist tests

In `server/bridge.test.mjs` (from plan 002), add cases mirroring the `/run`
denylist tests but against `/pi` with a valid sessionId: posting
`{"message":"rm -rf /","sessionId":"abc"}` yields a stream with a `type:"err"`
line containing "Blocked by guardrail" and a final `type:"exit"` `code === 126`.
Cover ≥2 patterns (e.g. `rm -rf /`, pipe-to-shell).

**Verify**: `node --test server/bridge.test.mjs` → all pass, including the new
`/pi` denylist cases.

### Step 3: Add a pending-command confirm in `v2/App.tsx`

Add transient state near the other UI-status state:

```ts
const [pendingCmd, setPendingCmd] = useState<string | null>(null);
```

Change `handleSuggestion` so a `command` suggestion opens the confirm instead of
running:

```ts
const handleSuggestion = (s: Suggestion) => {
  if (s.type === "command") setPendingCmd(s.text);
  else askChat(s.text);
};
```

Add `confirmPendingCmd` / `cancelPendingCmd`:

```ts
const confirmPendingCmd = () => { if (pendingCmd) { const c = pendingCmd; setPendingCmd(null); sendPI(c); } };
const cancelPendingCmd = () => setPendingCmd(null);
```

### Step 4: Render the confirm bar

When `pendingCmd` is non-null, render a confirm affordance that (a) shows the
exact command in a monospace block, (b) labels it clearly as transcript-derived
and about to run on the operator's machine with bash/write access, and (c) has
explicit **Run** and **Cancel** buttons — Cancel is the default/safe action.
Match the app's inline-style idiom (see the `filed`/`copied` button styling and
the `slideOver` overlay pattern already in the file). A minimal shape:

```tsx
{pendingCmd && (
  <div style={{ /* overlay, matching slideOver's inline style approach */ }}>
    <div style={{ /* card */ }}>
      <div>⚠ Run this command from the meeting on your machine?</div>
      <pre style={{ /* mono, wrap */ }}>{pendingCmd}</pre>
      <div>This was generated from live transcript text and runs with bash/write access.</div>
      <button onClick={cancelPendingCmd}>Cancel</button>
      <button onClick={confirmPendingCmd}>Run command</button>
    </div>
  </div>
)}
```

Accessibility: give the buttons real text labels (not icon-only); the warning
text must be actual text, not conveyed by color alone.

**Verify**: `npm run typecheck:v2` → exit 0; `npm run build:v2` → `✓ built`.

### Step 5: Live-verify the gate

Run `npm run dev:v2`, open `http://localhost:5173`, connect in demo mode, and —
if a `command` suggestion appears — click it and confirm the confirm bar shows
the command and does **not** run until "Run command" is clicked; "Cancel"
dismisses it. If no command suggestion arises naturally in demo mode, temporarily
verify by confirming the code path: `handleSuggestion` with a synthetic
`{type:"command"}` sets `pendingCmd` (a reviewer can trace this) — note in your
status update that demo mode did not organically produce one.

**Verify**: the confirm bar appears before any `/pi` call; `npm run verify` → exit 0.

## Test plan

- Extend `server/bridge.test.mjs` with `/pi` denylist cases (Step 2).
- The React confirm flow is verified live (Step 5) — do not add a jsdom suite for
  it (see plan 001/003 rationale: the component layer stays under manual QA).
- Verification: `npm run verify` → exit 0; bridge tests include `/pi` denylist.

## Done criteria

- [ ] `/pi` in `server/bridge.mjs` calls `denied(message)` and refuses with code 126 + audit log before spawn
- [ ] `server/bridge.test.mjs` has ≥2 passing `/pi` denylist cases
- [ ] `command` suggestions no longer call `sendPI` directly; they set `pendingCmd` and require an explicit Run click
- [ ] The confirm bar shows the exact command, warns it is transcript-derived, and Cancel is available
- [ ] `npm run verify` exits 0
- [ ] `plans/README.md` status row for 004 updated

## STOP conditions

- The `handleSuggestion` / `sendPI` code no longer matches the excerpt (drift) —
  re-read and report.
- Adding the denylist to `/pi` breaks an existing bridge test in a way that
  suggests the denylist regexes are wrong (report; don't rewrite the regexes here).
- The confirm overlay can't be rendered without touching out-of-scope layout
  code — report what's blocking.

## Maintenance notes

- If a future plan routes commands to the Thrivbe-OS kernel instead of local
  `/pi` (roadmap 6.2), this confirm gate should move to wrap *that* dispatch too —
  the principle is "transcript-derived side effects always confirm."
- A reviewer should check the confirm cannot be bypassed by keyboard (Enter
  shouldn't auto-run) and that `pendingCmd` is cleared on disconnect/new
  connection so a stale command can't linger across meetings.

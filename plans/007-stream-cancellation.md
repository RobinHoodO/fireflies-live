# Plan 007: Cancel in-flight streaming reads when they go stale

> **Executor instructions**: Follow step by step; run every verification command.
> On a STOP condition, stop and report. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 43c51bd..HEAD -- v2/backend.ts v2/App.tsx`
> On change, compare excerpts against live code; mismatch = STOP.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-verification-baseline.md
- **Category**: bug / perf
- **Planned at**: commit `43c51bd`, 2026-07-14

## Why this matters

`streamLiveAnswer` and `streamPI` run `for (;;) { await reader.read() }` with no
`AbortController` and no cleanup. Toggling question-mode off, reconnecting, or a
rapid new "Say this" cycle leaves the prior OpenRouter/PI stream draining to
completion in the background — network + decode work that the sequence guards
hide (they drop the *state write*) but never *stop*. Under an 8-30s pulse cadence
with slow responses these accumulate and waste tokens/connections. This plan
threads an abort signal so a superseded or unmounted stream is actually cancelled.

## Current state

`v2/backend.ts`:
- `streamLiveAnswer(ctx, key, context, model, onDelta)` (lines ~203-228): does
  `fetch(...)` with `stream: true`, then `const reader = r.body.getReader()` and a
  `for (;;)` read loop. No `signal`, no cancel.
- `streamPI(message, sessionId, bridgeToken, onDelta)` (lines ~249-272): same
  shape against `/bridge/pi`.

`v2/App.tsx`:
- The question-mode answer effect (lines ~317-342) calls `streamLiveAnswer(...)`
  and guards writes with `answerSeqRef`. There is no cleanup return that aborts.
- `sendPI` (lines ~450-466) calls `streamPI(...)` once per user/command action.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Typecheck | `npm run typecheck:v2` | exit 0 |
| Build | `npm run build:v2` | `✓ built` |
| Full verify | `npm run verify` | exit 0 |

## Scope

**In scope**: `v2/backend.ts` (`streamLiveAnswer`, `streamPI` signatures + fetch),
`v2/App.tsx` (the answer effect's cleanup; optionally `sendPI`).

**Out of scope**: the non-streaming `callAI` (short requests, not worth aborting);
the suggestion/nav/sentiment/agenda pulses (they use `callAI`, already short).

## Steps

### Step 1: Accept an `AbortSignal` in the streaming functions

Add an optional `signal?: AbortSignal` parameter to `streamLiveAnswer` and
`streamPI`, pass it into their `fetch(..., { signal })`, and let the natural
`AbortError` propagate (callers already `.catch`). Also call `reader.cancel()` in
a `finally` if the loop exits early. Shape for `streamLiveAnswer`:

```ts
export async function streamLiveAnswer(ctx, key, context, model, onDelta, signal?: AbortSignal): Promise<string> {
  const r = await fetch(URL, { method: "POST", headers, body: JSON.stringify({...}), signal });
  if (!r.ok || !r.body) return "";
  const reader = r.body.getReader();
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; /* ...existing parse... */ }
  } finally { try { await reader.cancel(); } catch {} }
  return full.trim();
}
```

Apply the equivalent to `streamPI`.

**Verify**: `npm run typecheck:v2` → exit 0.

### Step 2: Abort the answer stream on staleness / cleanup

In the question-mode answer effect (`v2/App.tsx:317-342`), create an
`AbortController` per run, pass `controller.signal` to `streamLiveAnswer`, and
return a cleanup function from the effect that calls `controller.abort()`. Because
the effect re-runs on `[lines, questionMode, orKey, pulseContext, fastModel]`, the
cleanup fires before each new run and on unmount — cancelling the prior stream.
Keep the existing `answerSeqRef` guard (belt and suspenders: the abort stops the
work, the seq guard stops any last write from a racing resolve).

```ts
useEffect(() => {
  // ...existing early returns...
  const controller = new AbortController();
  const seq = ++answerSeqRef.current;
  setAnswering(true);
  streamLiveAnswer(ctx, orKey, pulseContext, fastModel, partial => { if (seq === answerSeqRef.current) { /*...*/ } }, controller.signal)
    .then(final => { /* unchanged */ })
    .catch(() => { if (seq === answerSeqRef.current) setAnswering(false); });
  return () => controller.abort();
}, [lines, questionMode, orKey, pulseContext, fastModel]);
```

Ensure the `.catch` swallows `AbortError` without surfacing an error to the user
(it already sets `setAnswering(false)` — confirm an aborted run leaves the UI in a
clean state, not stuck "formulating").

**Verify**: `npm run typecheck:v2` → exit 0; `npm run build:v2` → `✓ built`.

### Step 3: (Optional) abort a superseded PI stream

If `sendPI` can be triggered again while a prior PI stream is active, store the
controller in a ref (`piAbortRef`) and abort the previous one at the start of a
new `sendPI`. Only do this if it doesn't complicate the existing `started`/thinking
state machine; if it does, leave `streamPI` accepting the signal (Step 1) but wire
the abort later — note it deferred.

**Verify**: `npm run typecheck:v2` → exit 0.

### Step 4: Live smoke

`npm run dev:v2`, connect demo mode, toggle "Meeting guide" (question mode) on
and off rapidly a few times. Confirm the UI doesn't get stuck in "formulating"
and no console errors appear (an `AbortError` is expected internally but must be
swallowed). Stop the dev server.

**Verify**: `npm run verify` → exit 0.

## Test plan

- Primarily live smoke (Step 4) — the streaming loop is I/O-bound and not worth a
  jsdom harness.
- Verification: `npm run verify` → exit 0.

## Done criteria

- [ ] `streamLiveAnswer` and `streamPI` accept an `AbortSignal`, pass it to `fetch`, and `reader.cancel()` in `finally`
- [ ] The question-mode effect creates an `AbortController` and aborts it in cleanup
- [ ] Rapidly toggling question mode leaves no stuck "formulating" state and no surfaced errors
- [ ] `npm run verify` exits 0
- [ ] `plans/README.md` status row for 007 updated

## STOP conditions

- The streaming functions no longer match the excerpts (drift) — re-read and report.
- Aborting causes a visible error toast/message the existing `.catch` doesn't
  swallow — report; the abort handling needs review before shipping.

## Maintenance notes

- Any future streaming endpoint (e.g. a streamed chat) should follow the same
  signal-threading pattern established here.
- A reviewer should confirm the `finally { reader.cancel() }` doesn't throw on an
  already-closed reader (it's wrapped in try/catch above — keep it).

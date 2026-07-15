# Plan 011: Cheap perf polish — debounce config persistence, scope the idle tick

> **Executor instructions**: Follow step by step; run every verification command.
> On a STOP condition, stop and report. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 43c51bd..HEAD -- v2/App.tsx`. Mismatch on an excerpt = STOP for that fix.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-verification-baseline.md; sequence after plan 010 (shares `v2/App.tsx`; largely moot once 010's memoization lands, but the debounce stands alone)
- **Category**: perf
- **Planned at**: commit `43c51bd`, 2026-07-14

## Why this matters

Two small waste sources: (1) the `fl-config` persistence effect runs a synchronous
`JSON.stringify` of the entire config — including the whole agenda array — on
**every keystroke** in the goal and custom-context textareas; (2) a `setInterval`
fires `force(n => n + 1)` every 5s purely to refresh relative-time labels,
re-rendering the whole (currently un-memoized) tree even when idle.

## Current state (`v2/App.tsx`)

- Persist effect (lines ~165-167): deps include `customContext`, `goal`, `agenda`;
  body `localStorage.setItem("fl-config", JSON.stringify({ ... }))`. The `goal`
  textarea (line ~932) and `customContext` textarea (line ~962) update state per
  keypress. (Note: if plan 006 Fix 3 already removed `agenda` from this object,
  the stringify is lighter but still per-keystroke — the debounce still applies.)
- Idle tick (line ~215): `useEffect(() => { const id = setInterval(() => force(n => n + 1), 5000); return () => clearInterval(id); }, [])`. Only consumer is `rel(s.t)` timestamps (line ~819, `data.ts`).

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Typecheck | `npm run typecheck:v2` | exit 0 |
| Build | `npm run build:v2` | `✓ built` |
| Full verify | `npm run verify` | exit 0 |

## Scope

**In scope**: `v2/App.tsx` (the persist effect and the idle-tick effect).
**Out of scope**: everything else; do not add a debounce library (write a tiny
inline `setTimeout` debounce or reuse `useDebounce` if one already exists — grep
first).

## Steps

### Step 1: Debounce the config write

Wrap the `localStorage.setItem("fl-config", ...)` in the persist effect in a
`setTimeout` (e.g. 400ms) cleared on the effect's cleanup, so rapid keystrokes
coalesce into one write:

```ts
useEffect(() => {
  const id = setTimeout(() => {
    try { localStorage.setItem("fl-config", JSON.stringify({ ... })); } catch {}
  }, 400);
  return () => clearTimeout(id);
}, [view, mode, model, fastModel, flags, rate, questionMode, customContext, goal /* , agenda if still present */]);
```

Keep the exact object shape currently persisted (don't add/remove fields here —
that's plan 006's job).

**Verify**: `npm run typecheck:v2` → exit 0. Live: `npm run dev:v2`, change the
goal text, reload → the last-typed value is restored (debounce still persists on
settle). Stop the server.

### Step 2: Leave the idle tick, but confirm it's cheap after memoization

If plan 010 has landed (relative-time labels live in a memoized child), the 5s
`force` tick only reconciles that child — acceptable; leave it. If plan 010 has
**not** landed, coarsen the interval to 30s (relative-time labels like "2m ago"
don't need 5s granularity) to cut idle full-tree re-renders 6×:

```ts
const id = setInterval(() => force(n => n + 1), 30000);
```

Pick one based on whether 010 is done; note your choice in the status update.

**Verify**: `npm run build:v2` → `✓ built`; `npm run verify` → exit 0.

## Done criteria

- [ ] The `fl-config` write is debounced (coalesces rapid keystrokes)
- [ ] Reloading after editing goal/custom-context still restores the settled value
- [ ] The idle tick is either confirmed-cheap (post-010) or coarsened to 30s
- [ ] `npm run verify` exits 0
- [ ] `plans/README.md` status row for 011 updated

## STOP conditions

- Debouncing drops the final write (value not restored after reload) — the cleanup
  is clearing the pending timeout without a final flush; add a `pagehide`/unmount
  flush like the app does elsewhere, or report.

## Maintenance notes

- The app already uses a debounced + pagehide-flush pattern for session
  persistence (per the roadmap's Phase 2 notes) — match that pattern if a plain
  `setTimeout` proves lossy on tab close.

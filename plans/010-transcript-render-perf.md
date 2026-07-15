# Plan 010: Stop re-rendering the whole app on every streamed word

> **Executor instructions**: Follow step by step; run every verification command.
> This touches the app's hot path and its scroll/focus logic — the live smokes in
> the steps are mandatory, not optional. On a STOP condition, stop and report.
> Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 43c51bd..HEAD -- v2/App.tsx`
> On change, compare excerpts against live code; mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — memoizing a god-component can shift the custom stick-to-bottom scroll and composer-focus behavior. Verify those specifically.
- **Depends on**: plans/001-verification-baseline.md; best sequenced after plan 006 (shares `v2/App.tsx`)
- **Category**: perf
- **Planned at**: commit `43c51bd`, 2026-07-14

## Why this matters

`v2/App.tsx` is one ~1080-line component holding all state. `onTranscriptLine` →
`setLines` fires **per streamed word** while a live socket runs, and the entire
component body re-executes and reconciles the whole tree each time — including
`grouped` (an O(n) reduce over the full transcript), `filtered`/`counts`, the
`MODELS` label loops, and the whole config slide-over markup — with **zero**
`useMemo`/`React.memo` in the file. Worse, `lines` grows unbounded on the live
append path (the restore path caps at 500, live append does not), so late in a
meeting each word pays an O(n) reduce + O(n) DOM diff. Typing/streaming latency
scales with transcript length — the exact hot path the app exists for. This plan
caps `lines`, memoizes the derived values, and splits the heaviest subtrees into
memoized children.

## Current state (`v2/App.tsx`)

- One component, all state at top (line 84 onward). Only 3 `useCallback`, no
  `useMemo`, no `React.memo` (verified by grep).
- `onTranscriptLine` (lines ~364-374) appends with **no cap**:
  `return [...prev, { speaker, text, isFinal, id: ... }]`.
- Restore path caps: `SESSION.lines ... .slice(-500)` (line 140).
- `grouped` (lines ~183-188): recomputed every render.
- `filtered` / `counts` (lines ~565-566): recomputed every render.
- `modeLabel` / `modelLabel` (lines ~570-571): loop `MODELS` every render.
- `header`, `transcriptCard`, `sidebarCard`, `slideOver` are inline consts rebuilt
  each render (lines ~620, 684, 878, 919).
- Custom scroll: `useStickToBottom` (lines 66-72) + `useLayoutEffect` sticks on
  `[lines, liveAnswer]` etc. (lines 195-198). Composer focus via `chatComposerRef`.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Typecheck | `npm run typecheck:v2` | exit 0 |
| Build | `npm run build:v2` | `✓ built` |
| Full verify | `npm run verify` | exit 0 |
| Live | `npm run dev:v2` + browser demo | streaming smooth; scroll/focus intact |

## Scope

**In scope**: `v2/App.tsx` only.

**Out of scope**: `v2/backend.ts`, styling, the feature behavior. Do NOT
introduce a virtualization library (new dep) — capping + memoization is the
ponytail-approved fix; virtualization is a later step only if measurement demands
it (note it, don't build it).

## Steps

### Step 1: Cap `lines` on the live-append path

In `onTranscriptLine`, cap the retained array to the last 500 (mirror the restore
cap) on every append branch. E.g. wrap the returns so the final array is
`next.length > 500 ? next.slice(-500) : next`. Ensure the upsert-by-`chunk_id`
branch (the `key != null` path) still works — cap only when appending a new line,
and keep the cap consistent so `grouped` and the map-prune (plan 006 Fix 4) stay
correct.

**Verify**: `npm run typecheck:v2` → exit 0. Live: stream a long demo; confirm the
transcript still shows recent lines and doesn't error.

### Step 2: Memoize the derived values

Wrap in `useMemo` with correct deps:
- `grouped` → `useMemo(() => lines.reduce(...), [lines])`
- `filtered` → `useMemo(() => sortFeedItems(...), [suggestions, filter, feedSort])`
- `counts` → `useMemo(() => { ... }, [suggestions])`
- `modeLabel` / `modelLabel` → `useMemo(..., [mode, suggested])` / `[model]`

Keep the computed values' semantics identical — only wrap them. Watch for values
that close over other derived values (e.g. `filtered` uses `suggestions`).

**Verify**: `npm run typecheck:v2` → exit 0; `npm run build:v2` → `✓ built`.

### Step 3: Extract the heaviest subtrees as `React.memo` children

Split at least the transcript list and the config slide-over into memoized
components so a transcript update doesn't reconcile the slide-over, and a config
keystroke doesn't reconcile the transcript. Suggested extractions:
- `TranscriptList` — takes `grouped`, `isConnected`, `questionMode`-related props;
  wrap in `React.memo`. The stick-to-bottom scroll ref must stay attached to the
  scroll container — pass the ref down or keep the scroller in the parent and
  memoize only the inner `grouped.map` list.
- `ConfigSlideOver` — takes the config state + setters; `React.memo`.

Because these currently close over dozens of locals, thread props explicitly.
This is the risky step: keep each extraction small and verify scroll/focus after
each. If an extraction balloons the prop list to an unmanageable size, prefer
memoizing the JSX via `useMemo` (cheaper, keeps closures) over a full component
split — either achieves the goal of skipping reconciliation.

**Verify**: `npm run typecheck:v2` → exit 0; `npm run build:v2` → `✓ built`.

### Step 4: Mandatory scroll/focus/live smoke

`npm run dev:v2`, open the app, connect demo mode, and verify ALL of:
- Streaming words render smoothly; the transcript **auto-scrolls to bottom** while
  new lines arrive.
- Scroll up mid-stream → auto-scroll does **not** hijack you back to bottom (the
  `nearBottom` logic still works).
- Open the config slide-over, type in the goal textarea → the cursor/focus stays
  in the textarea (no focus loss from a parent re-render).
- Toggle question mode; the "Say this" banner still updates.
- No console errors.
Stop the dev server.

**Verify**: all of the above hold; `npm run verify` → exit 0.

## Test plan

- This layer stays under live QA (per plan 001's rationale — a jsdom harness here
  would mostly test mocks). The Step 4 smoke is the acceptance test; treat its
  checklist as the pass/fail gate.

## Done criteria

- [ ] `lines` is capped at 500 on the live-append path
- [ ] `grouped`, `filtered`, `counts`, `modeLabel`, `modelLabel` are memoized
- [ ] At least the transcript list and config slide-over no longer reconcile on
      unrelated updates (via `React.memo` children or `useMemo`'d JSX)
- [ ] The Step 4 smoke passes in full (streaming smooth, auto-scroll correct,
      scroll-up not hijacked, composer focus retained, no console errors)
- [ ] `npm run verify` exits 0
- [ ] `plans/README.md` status row for 010 updated

## STOP conditions

- Any excerpt doesn't match live code (drift) — re-read and report.
- After memoization, the stick-to-bottom scroll breaks (hijacks after scroll-up,
  or stops following) and one fix attempt doesn't restore it — STOP; scroll
  behavior is load-bearing UX and must not regress.
- Composer loses focus on keystroke after a component split — STOP; revert that
  split and use `useMemo`'d JSX instead.

## Maintenance notes

- If transcripts routinely exceed a few thousand lines and the 500 cap loses
  needed history, revisit with windowed virtualization (a dep decision for the
  operator) — the cap is the lazy-correct first move; note the ceiling.
- A reviewer should scrutinize the `useMemo` dependency arrays (a missing dep
  causes stale UI; an over-broad dep defeats the memo) and the scroll-ref plumbing
  after any component extraction.

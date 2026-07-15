# Plan 006: Four small correctness fixes (env regex, pulse race, clean-boot agenda, map leak)

> **Executor instructions**: Follow step by step; each fix is independent — run
> the verification after each so a later fix's failure doesn't mask an earlier
> success. On a STOP condition, stop and report. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 43c51bd..HEAD -- v2/App.tsx v2/vite.config.ts vite.config.ts`
> On change, compare each excerpt against live code before touching it; mismatch
> on a given fix = skip that fix and report.

## Status

- **Priority**: P2
- **Effort**: S (each of four fixes is S)
- **Risk**: LOW
- **Depends on**: plans/001-verification-baseline.md (for `typecheck:v2` gate)
- **Category**: bug
- **Planned at**: commit `43c51bd`, 2026-07-14

## Why this matters

Four independent, low-risk correctness bugs, each cheap to fix:
1. The `.env` key regex is unanchored and keeps quotes → can extract the wrong
   variable or a quoted value, silently failing auth on every Fireflies/OpenRouter
   call.
2. The suggestion pulse is the only async writer with no sequence guard → a slow
   response can overwrite a newer one and resurrect a just-dismissed item.
3. The dynamic agenda persists into `fl-config` and reappears on a "clean" boot,
   contradicting the documented "opens clean every time" design.
4. `consumedTranscriptWordsRef` grows one entry per transcript line for the whole
   session and is never pruned (while `lines` is capped) → slow memory creep.

## Current state

**Fix 1 — env regex** (`v2/vite.config.ts:27-28`, and identical at `vite.config.ts:33-34`):
```js
const ffMatch = env.match(/FIREFLY_API_KEY=(.+)/);
const orMatch = env.match(/OPENROUTER_API=(.+)/);
```
`.match` is unanchored (matches the first occurrence anywhere) and `(.+)` keeps
surrounding quotes; `.trim()` (line 30) does not strip quotes.

**Fix 2 — suggestion pulse** (`v2/App.tsx:219-246`): the effect throttles via
`lastSuggestRef` but calls `fetchSuggestions(...).then(setSuggestions(...))` with
**no `*SeqRef` guard** — unlike `runNav` (`navSeqRef`), `runSentiment`
(`sentimentSeqRef`), `runAgenda` (`agendaSeqRef`), and the answer effect
(`answerSeqRef`). Refs are declared around line 151-156.

**Fix 3 — agenda persistence** (`v2/App.tsx:166` inside the persist effect):
```js
localStorage.setItem("fl-config", JSON.stringify({ view, mode, model, fastModel, flags, rate, questionMode, customContext, goal, piSession: piSessionRef.current, agenda }));
```
and restore (`v2/App.tsx:118-125`): agenda is read from `SESSION.agenda ?? SAVED.agenda`;
since `SESSION` is always `{}` (line 23 clears `fl-session`), it falls back to the
**persisted** `SAVED.agenda`. Every other meeting artifact lives in the cleared
`fl-session`; only agenda leaks across boots via `fl-config`. The doc note at
line 22 states sessions open clean by design.

**Fix 4 — map leak** (`v2/App.tsx:296-304`, the karaoke effect):
`consumedTranscriptWordsRef.current.set(line.id, words.length)` per touched line;
the map is cleared only in `startConnection` (line 402). `lines` itself is capped
at 500 on the restore path (line 140) but the map is never pruned.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Typecheck | `npm run typecheck:v2` | exit 0 |
| Build | `npm run build:v2` | `✓ built` |
| Full verify | `npm run verify` | exit 0 |

## Scope

**In scope**: `v2/App.tsx`, `v2/vite.config.ts`, `vite.config.ts` (the v1 config
gets the identical env-regex fix for consistency — it's a two-line change and
keeps the two configs from diverging; if plan 008 later deletes v1, this is
harmless).

**Out of scope**: any behavior beyond these four fixes; the perf refactor
(plan 010); the streaming-cancellation fix (plan 007).

## Steps

### Step 1: Anchor the env regex (Fix 1)

In `v2/vite.config.ts` replace the two matches with multiline-anchored versions
that strip surrounding quotes:

```js
const readKey = (name) => {
  const m = env.match(new RegExp(`^${name}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "").trim() : "";
};
// ...
res.end(JSON.stringify({ ffKey: readKey("FIREFLY_API_KEY"), orKey: readKey("OPENROUTER_API"), bridgeToken }));
```

Apply the same `readKey` change in `vite.config.ts` (v1). Keep everything else in
the key-plugin unchanged.

**Verify**: `npm run typecheck:v2` → exit 0. Then a runtime smoke: `npm run dev:v2`,
and confirm the app boots and (in a browser) the AI is not stuck "offline" — i.e.
the OpenRouter key still resolves. Stop the dev server after confirming.

### Step 2: Add a sequence guard to the suggestion pulse (Fix 2)

Declare a ref beside the others (near line 151):
```ts
const lastSuggestRef = useRef(0); const suggestSeqRef = useRef(0);
```
(`lastSuggestRef` already exists — add only `suggestSeqRef`.) In the pulse effect
(line ~223), capture the sequence before the fetch and bail on staleness:

```ts
lastSuggestRef.current = now;
const seq = ++suggestSeqRef.current;
const ctx = ...;
fetchSuggestions(...).then(items => {
  if (seq !== suggestSeqRef.current) return;   // stale response, drop
  if (!items.length) return;
  setSuggestions(prev => { ... });             // unchanged merge body
}).catch(() => {});
```

Also bump `suggestSeqRef.current++` in `startConnection` (line ~402) alongside the
other seq-ref bumps, so an in-flight pulse from a prior meeting can't apply after
reconnect.

**Verify**: `npm run typecheck:v2` → exit 0.

### Step 3: Keep the agenda out of the clean boot (Fix 3)

Persist only the agenda **feature flag**, not the items. Two edits:

1. In the persist effect (line 166), remove `agenda` from the `fl-config` object
   and drop it from the effect dependency array (line 167). The `flags` object
   (which contains the `agenda` on/off toggle) stays.
2. In the restore (lines 118-125), change the source so items come only from the
   session blob (which is cleared on boot), i.e. read from `SESSION.agenda` only,
   dropping the `?? SAVED.agenda` fallback. On a fresh boot this yields an empty
   agenda — matching every other artifact.

**Verify**: `npm run typecheck:v2` → exit 0. Runtime: `npm run dev:v2`, add an
agenda item, reload the page → the agenda list is empty on the fresh (pre-connect)
view, like the transcript/feed. Stop the dev server.

### Step 4: Prune the karaoke map when lines are trimmed (Fix 4)

The simplest correct fix: after building the new `lines` in `onTranscriptLine`, or
inside the karaoke effect, delete map keys not present in the current `lines`. Do
it where `lines` is known. In the karaoke effect (line ~296), after the loop, add
a prune keyed to the live line ids:

```ts
// prune consumption entries for lines no longer retained
if (consumedTranscriptWordsRef.current.size > lines.length) {
  const live = new Set(lines.map(l => l.id));
  for (const id of consumedTranscriptWordsRef.current.keys()) if (!live.has(id)) consumedTranscriptWordsRef.current.delete(id);
}
```

This is O(map size) only when the map outgrows the line list, which is exactly the
leak condition.

**Verify**: `npm run typecheck:v2` → exit 0; `npm run build:v2` → `✓ built`.

### Step 5: Full verify

**Verify**: `npm run verify` → exit 0.

## Test plan

- These are UI-integrated fixes; the existing manual demo QA covers them, plus the
  two runtime smokes in Steps 1 and 3.
- If plan 003 landed first, you may add a `readKey` unit test (feed a fake `.env`
  string with a decoy `EXTRA_FIREFLY_API_KEY=` line and a quoted value, assert the
  canonical unquoted value is returned) — optional but cheap.

## Done criteria

- [ ] `.env` key extraction is line-anchored and strips surrounding quotes, in both configs
- [ ] The suggestion pulse has a `suggestSeqRef` guard and is bumped in `startConnection`
- [ ] Agenda items are no longer written to `fl-config`; a fresh boot shows an empty agenda pre-connect
- [ ] `consumedTranscriptWordsRef` is pruned to live line ids
- [ ] `npm run verify` exits 0
- [ ] `plans/README.md` status row for 006 updated

## STOP conditions

- Any excerpt doesn't match live code (drift) — skip that specific fix, apply the
  others, and report which was skipped.
- The Step 1 runtime smoke shows the AI stuck "offline" after the regex change
  (the new regex failed to extract a real key) — revert Step 1 and report the
  actual `.env` line format (do not paste the key value).
- Fix 3's restore change white-screens the app (a shape assumption broke) — revert
  Step 3 only and report.

## Maintenance notes

- Fix 3: if a future feature *wants* the agenda to survive reloads intentionally,
  it should live in a purpose-named `fl-agenda` key with its own shape validation,
  not ride along in `fl-config`.
- Fix 4: once plan 010 caps `lines` on the live-append path too, this prune stays
  correct (it keys off whatever `lines` currently holds).

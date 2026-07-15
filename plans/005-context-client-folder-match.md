# Plan 005: Stop `/context` from injecting the wrong client's private documents

> **Executor instructions**: Follow step by step; run every verification command.
> On a STOP condition, stop and report. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 43c51bd..HEAD -- server/bridge.mjs`
> On change, compare the excerpt against live code; mismatch = STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (tightening the match may stop some legitimate folders resolving — mitigated by tests)
- **Depends on**: plans/002-bridge-guard-tests.md (test harness pattern; add `/context` matching tests)
- **Category**: security / correctness
- **Planned at**: commit `43c51bd`, 2026-07-14

## Why this matters

The constellation feature (`POST /context`) enriches a live call with the
operator's own prep. To find the relevant client folder it matches directory
names against words drawn from **counterpart + topic + goal**, using a loose
substring-OR with a length>3 filter. A generic goal word — "website", "renewal",
"creation" — can therefore match an *unrelated* client directory, and that
folder's `.md` files (up to 8) are read verbatim and injected into the AI context
for the current call. That is one client's private prep material leaking into a
different client's live conversation: a confidentiality defect, not just noise.
This plan tightens the match to the counterpart identity and adds a relevance
threshold so a stray goal word can't pull the wrong folder.

## Current state

`server/bridge.mjs:254-294` — the client-folder resolution block. The match:

```js
// lines ~259-262
const words = [counterpart, topic, goal].join(" ").toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((word) => word.length > 3) || [];
const folders = await readdir(CLIENTS_ROOT, { withFileTypes: true });
const folder = folders.find((entry) => entry.isDirectory() && words.some((word) => entry.name.toLowerCase().includes(word)));
```

Once `folder` is found, lines 263-290 read its top-level `.md` files plus one
level of subfolders (capped at 8 files, 1200 chars each) and build a
`client` object injected into the bundle (line ~300-304). `CLIENTS_ROOT` is
`/Users/robinsverd/Thrivbe-AI/clients` (line 27). `rootedPath` already prevents
path escape; the problem is *which* folder is chosen, not traversal.

The request contract (`docs/ADAPTIVE-NAVIGATOR.md:73`):
`{ goal: string, counterpart?: string, topic?: string }`. The comment at
`bridge.mjs:257-258` explains the current intent: "a client name typed only into
the goal field should still resolve" — that intent is legitimate but the
implementation is too loose.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Syntax check | `node --check server/bridge.mjs` | exit 0 |
| Bridge tests | `node --test server/bridge.test.mjs` | all pass |
| Full verify | `npm run verify` | exit 0 |

## Scope

**In scope**:
- `server/bridge.mjs` — the folder-matching logic in the `/context` block (lines ~259-262), and only that logic. The file-reading, bundling, and size-budget code stays as-is.
- `server/bridge.test.mjs` — add `/context` folder-matching tests (this needs a temp `CLIENTS_ROOT`; see Step 3).

**Out of scope**:
- The semsearch fan-out, the meeting-file reads, the bundle size budget.
- `rootedPath` (traversal is handled; that's plan 014).
- Changing the request contract or the UI inputs.

## Steps

### Step 1: Make `CLIENTS_ROOT` overridable for tests

If `CLIENTS_ROOT` (line 27) is a bare constant, change only that line to:

```js
const CLIENTS_ROOT = process.env.BRIDGE_CLIENTS_ROOT || "/Users/robinsverd/Thrivbe-AI/clients";
```

(Mirror the `BRIDGE_FILE_DIR` override from plan 002.) Nothing else changes yet.

**Verify**: `node --check server/bridge.mjs` → exit 0.

### Step 2: Tighten the folder match

Replace the loose OR match. Requirements for the new logic:

1. **Prefer the counterpart identity.** Build the candidate word set primarily
   from `counterpart` (the field that names who the call is with). Only fall back
   to `topic`/`goal` words when `counterpart` is empty.
2. **Require a stronger match than "substring includes".** A folder qualifies
   only when a candidate word matches a **whole word** of the folder name (split
   the folder name on non-alphanumerics and compare token-equality,
   case-insensitively), OR the folder name as a whole is contained in the
   counterpart string. This stops "website" from matching a folder merely
   containing that substring.
3. **Score and threshold when multiple qualify.** If more than one folder
   qualifies, pick the one with the most matching whole-word tokens; if the best
   score is a single generic token drawn only from `goal` (not counterpart/topic),
   do not select any folder (return no client section rather than a wrong one).

A shape that satisfies this:

```js
const norm = (s) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((w) => w.length > 3) || [];
const idWords = counterpart ? norm(counterpart) : [];               // primary
const fallbackWords = idWords.length ? [] : [...norm(topic), ...norm(goal)];
const candidateWords = idWords.length ? idWords : fallbackWords;
const folders = await readdir(CLIENTS_ROOT, { withFileTypes: true });
const scoredFolders = folders
  .filter((e) => e.isDirectory())
  .map((e) => {
    const folderTokens = new Set(norm(e.name));
    const hits = candidateWords.filter((w) => folderTokens.has(w) || counterpart.toLowerCase().includes(e.name.toLowerCase()));
    return { entry: e, score: hits.length };
  })
  .filter((c) => c.score > 0)
  .sort((a, b) => b.score - a.score);
// Only accept a fallback (goal-only) match if it is unambiguous (score >= 1 AND
// derived from counterpart/topic, not a lone generic goal word). When counterpart
// is present, idWords already scoped it; when absent, require the match to come
// from topic, not goal alone:
const folder = idWords.length
  ? scoredFolders[0]?.entry
  : (norm(topic).some((w) => scoredFolders[0] && new Set(norm(scoredFolders[0].entry.name)).has(w)) ? scoredFolders[0].entry : undefined);
```

You may implement this differently as long as it meets the three requirements and
the tests in Step 3 pass. Keep the `try/catch` and the rest of the block
(reading files, building `client`) unchanged — only the *selection* changes.

**Verify**: `node --check server/bridge.mjs` → exit 0.

### Step 3: Add folder-matching tests

In `server/bridge.test.mjs`, create a temp `CLIENTS_ROOT` in the `before` hook
(via `BRIDGE_CLIENTS_ROOT`) containing two fixture folders, e.g.
`Toniic/notes.md` and `Acme-Website/prep.md`. Because `/context` also calls
semsearch (which may be down), assert on the folder-selection outcome by checking
whether the returned bundle includes the `📁 Client folder` section for the right
directory. Cases:

1. `{"counterpart":"Toniic","goal":"website creation"}` → bundle's client
   section names `Toniic`, NOT `Acme-Website` (the generic "website" goal word
   must not pull Acme).
2. `{"goal":"build a website"}` with no counterpart/topic → **no** client section
   (a lone generic goal word selects nothing).
3. `{"counterpart":"Acme Website"}` → selects `Acme-Website`.

If semsearch being unreachable makes `/context` return `ok:false` with no
sections at all, guard the assertions to check the *client* section specifically
(present/absent) rather than overall `ok`. If you cannot isolate the client
section because the whole response is gated on semsearch reachability, STOP and
report — the test seam may need a semsearch stub, which is an operator decision.

**Verify**: `node --test server/bridge.test.mjs` → all pass including the 3 new cases.

## Test plan

- 3 folder-matching cases in `server/bridge.test.mjs` using a temp
  `BRIDGE_CLIENTS_ROOT` with two fixture client folders.
- Verification: `npm run verify` → exit 0.

## Done criteria

- [ ] A generic word appearing only in `goal` no longer selects an unrelated client folder (test case 1 + 2 pass)
- [ ] `counterpart` is the primary match source; `topic`/`goal` only fall back when counterpart is empty
- [ ] `CLIENTS_ROOT` is overridable via `BRIDGE_CLIENTS_ROOT`
- [ ] `node --test server/bridge.test.mjs` passes with the 3 new cases
- [ ] `npm run verify` exits 0
- [ ] `plans/README.md` status row for 005 updated

## STOP conditions

- The matching block no longer matches the excerpt (drift) — re-read and report.
- The test cannot isolate the client-folder section because `/context` short-
  circuits on semsearch being unreachable — report; a semsearch stub is an
  operator decision.
- Tightening the match makes a legitimately-named real folder stop resolving in a
  way the three requirements didn't anticipate — report the folder name pattern.

## Maintenance notes

- The real fix envisioned in the roadmap is server-side retrieval via the
  Thrivbe-OS kernel (Phase 7.4), where client scoping can use structured IDs
  instead of folder-name heuristics. This plan is the interim safety fix; note it
  as such so it isn't mistaken for the final design.
- A reviewer should confirm the operator can still deliberately pull a client
  folder by naming it in the counterpart field — the fix must not break the
  legitimate path, only the accidental cross-client one.

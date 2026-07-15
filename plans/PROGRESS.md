# Progress — advisor plans execution

Executed 2026-07-15 against base commit `43c51bd` (no drift; all plans applied
as written). All work committed directly to `main`. `npm run verify` green at
every commit: 36 tests, 0 fail, v2 typecheck + lint + build passing.

## Shipped (plans 001–005)

| Plan | Commit | What shipped |
|------|--------|--------------|
| 001 | `54b948a` | `tsconfig.v2.json` (v2 now actually typechecked — zero pre-existing errors), v2 reference in `tsconfig.json` (`tsc -b` still green), scripts: `typecheck:v2`, `dev:v2`, `build:v2`, `preview:v2`, `test` (`node --test`), and the aggregate `npm run verify` gate. Plans dir committed alongside. |
| 002 | `91e365d` | `server/bridge.test.mjs`: 17 tests freezing the bridge guards — health, missing/wrong token→401, non-JSON→415, OPTIONS→403, forged-Host→403, `/run` denylist (rm -rf /, fork bomb, pipe-to-shell) + benign allow, `/pi` bad sessionId, `/file` slug sanitize + collision suffix + 400, `/context` empty→400 + no-token→401. Only bridge change: `FILE_DIR` overridable via `BRIDGE_FILE_DIR` (tests write to a temp dir, real transcripts untouched). |
| 003 | `89f8749` | `v2/md.test.ts` + `v2/backend.test.ts` (14 tests) pinning `mdToHtml` HTML-escaping (script/img/amp payloads + bold/code/list round-trips), `modelJsonArray`/`modelJsonObject` fence-stripping and shape rejection, and exact `shq` shell escaping. `v2/backend.ts` diff is the 3-line test-only `__test` export. Node 22.22 runs `.ts` tests natively (type stripping) — no loader needed. |
| 004 | `deee127` | Transcript-derived `command` suggestions no longer run on one click: `handleSuggestion` now opens a confirm dialog (exact command in monospace, explicit "generated from live transcript / runs with bash-write access" warning, Cancel autofocused so Enter never runs). `pendingCmd` cleared on new connection. Bridge `/pi` now runs the same `denied()` denylist as `/run` (refuse + `PI-BLOCKED` audit line + exit 126), with 2 new tests. Live-verified in Chrome against the running dev server: dialog renders, Enter cancels, nothing sent to `/pi`. |
| 005 | `7b3895e` | `/context` client-folder match tightened: counterpart is the primary source (topic/goal only when it's empty), whole-word token matches only, scored with best-first, and a lone generic goal word selects nothing. `CLIENTS_ROOT` overridable via `BRIDGE_CLIENTS_ROOT`. 3 new tests with fixture folders prove "Toniic + website creation" pulls Toniic (not Acme-Website), goal-only "build a website" pulls nothing, and "Acme Website" still resolves `Acme-Website`. |

## Notes / deviations

- **Plan 003 Step 4 (optional) skipped as the plan directs**: sentiment-clamp
  cases need a `callAI` injection seam — deferred, not improvised.
- **Plan 004 live check**: demo mode doesn't deterministically produce a
  `command` suggestion, so the dialog was verified by temporarily seeding
  `pendingCmd` (reverted before commit) — rendering, Enter-cancels-safely, and
  no `/pi` call were all confirmed in the browser.
- **Behavior change from 005 worth knowing**: a client name typed *only* into
  the goal field no longer resolves a folder (the old comment's intent). Use the
  counterpart field — that's the designed legitimate path, and it's tested.
- The running dev server's bridge child process predates these changes —
  restart `npm run dev:v2` to pick up the `/pi` denylist and `/context` fix.
- `tsconfig.v2.tsbuildinfo` is a new untracked build artifact (from `tsc -b`) —
  plan 015 (housekeeping/gitignore) will catch it.

## Shipped (plans 006–015, second pass 2026-07-15)

| Plan | Commit | What shipped |
|------|--------|--------------|
| 008 | _(see git log)_ | Legacy v1 retired: deleted `src/`, root `index.html`, root `vite.config.ts`, `tsconfig.app.json`; dropped `react-markdown`, `remark-gfm`, `lucide-react`, `tailwindcss`, `@tailwindcss/vite`. Default `dev`/`build`/`preview` now target v2 (`--config v2/vite.config.ts`); `build` typechecks v2; `verify` = lint + test + build (build includes the typecheck, so no double pass); `:v2` dev/build/preview aliases removed, `typecheck:v2` kept. `tsconfig.node.json` repointed at `v2/vite.config.ts`. Only `src/` mention left is a provenance comment in `v2/backend.ts`. |
| 007 | _(see git log)_ | `streamLiveAnswer`/`streamPI` accept an `AbortSignal` (passed to fetch) and `reader.cancel()` in `finally`. **Deviation from the plan's sample:** returning `controller.abort()` from the effect cleanup would have killed every stream one word after it started (the effect re-runs per streamed word; the 5s throttle starts nothing on most re-runs but cleanup still fires). Implemented the stated intent instead: `answerAbortRef` aborts only when a newer stream starts, question mode turns off/disconnects, or on unmount. Step 3 (aborting superseded PI streams) deferred as the plan permits — sequential PI sends are legitimate turns; `streamPI` has the signal seam for later. Live smoke: rapid Meeting-guide toggling mid-connection, no stuck "formulating", zero console errors. |
| 010 | _(see git log)_ | Render perf: `lines` capped at 500 on the live-append path; `grouped`/`filtered`/`counts`/`modeLabel`/`modelLabel` memoized; transcript list and config slide-over are `useMemo`'d JSX (per plan's low-risk option) so per-word updates don't reconcile the config panel and config keystrokes don't reconcile up to 500 line nodes. `getCtx` reads via `groupedRef` so memoized handlers never see a stale transcript; slide-over's "Suggest from meeting" gates on a stable `hasTranscript` boolean. Full live smoke in demo mode: streaming smooth, stick-to-bottom + scroll-up-no-hijack verified programmatically, config typing kept focus, Meeting guide + Say-this + navigator + sentiment + suggestion feed all live, zero console errors. |
| 009 | _(see git log)_ | Root `CLAUDE.md` (52 lines, pointer-first): active app = v2 (src/ deleted), real run/verify commands (each executed and confirmed), bridge security invariants + pointer to `bridge.test.mjs` as the regression net, env key names/location only, inline-style + delegation conventions. |
| 006 | _(see git log)_ | Four correctness fixes: line-anchored + quote-stripping `.env` key extraction in both vite configs (`readKey`); `suggestSeqRef` staleness guard on the suggestion pulse (bumped on reconnect); agenda no longer persisted in `fl-config` and restored only from the session blob (clean boot by design); karaoke `consumedTranscriptWordsRef` pruned to live line ids. Browser-verified: keys resolve unquoted, fresh boot writes agenda-free config. |

## Left in the queue (per plans/README.md order)

Security/tests P1 are done. Remaining: 006 (correctness bundle) → 008 (retire
v1) → 009 (CLAUDE.md) → 010 (render perf, after 006) → 003-follow-ups none →
007, 011, 012, 013, 014, 015 (P3 polish, any order). Deferred: TS 6→7 bump
after 008.

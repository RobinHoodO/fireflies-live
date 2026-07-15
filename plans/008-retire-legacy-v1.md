# Plan 008: Retire the legacy v1 app and drop its dependencies

> **Executor instructions**: Follow step by step; run every verification command.
> This plan deletes code — the drift check and STOP conditions matter more than
> usual. On any STOP condition, stop and report. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 43c51bd..HEAD -- package.json index.html vite.config.ts tsconfig.app.json src/`
> On change, re-read the affected excerpts before proceeding; mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (v1 is not the active app) — but it is a deletion, so verify carefully
- **Depends on**: plans/001-verification-baseline.md (so `npm run verify` covers v2 before v1 is removed)
- **Category**: tech-debt / migration
- **Planned at**: commit `43c51bd`, 2026-07-14

## Why this matters

There are two complete apps in one repo. `v2/` is the active one; `src/` is a
781-line divergent v1 copy that v2 has superseded (v2 adds agenda, navigator,
sentiment, streaming). But the **default** `npm run dev`/`build` and root
`index.html` still launch and ship v1 — a real "shipped the wrong app" hazard —
and v1 is the sole reason five dependencies (`react-markdown`, `remark-gfm`,
`lucide-react`, `tailwindcss`, `@tailwindcss/vite`) and the `tsconfig.app.json`
`src` include must stay. Retiring v1 removes the confusion, the drift trap, and
those deps, and lets the default scripts point at the real app.

## Current state

- `package.json:7-8`: `"dev": "vite"`, `"build": "tsc -b && vite build"` — both
  use the root `vite.config.ts` (v1).
- Root `index.html:11` loads `/src/main.tsx` (v1 entry).
- Root `vite.config.ts` wires `@tailwindcss/vite` (lines ~3, 48) and serves the
  v1 key plugin — this is the v1 build.
- `tsconfig.app.json:24`: `"include": ["src"]`.
- v1-only deps (verified by the perf/deps audit — grep `v2/` + `server/` finds
  zero imports of these):
  - `react-markdown`, `remark-gfm` — imported only at `src/App.tsx:8-9`
  - `lucide-react` — only at `src/App.tsx:7`
  - `tailwindcss` — only via `src/index.css:2` (`@import "tailwindcss"`)
  - `@tailwindcss/vite` — only in root `vite.config.ts`
- v2 uses its own `v2/md.ts` (markdown), `v2/icons.tsx` (icons), `v2/styles.css`
  (styles) — none of the above.
- `src/` contents: `App.tsx`, `App.css`, `index.css`, `main.tsx`, `types.ts`,
  `assets/`, `data/`.

**Before deleting anything, re-confirm the zero-import claim** (Step 1) — the
audit is a lead, not a guarantee.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Confirm no v2/server imports of a dep | `grep -rn "react-markdown\|remark-gfm\|lucide-react\|tailwindcss" v2 server` | no matches |
| Typecheck v2 | `npm run typecheck:v2` | exit 0 |
| Build v2 | `npm run build:v2` | `✓ built` |
| Full verify | `npm run verify` | exit 0 |
| Install after dep removal | `npm install` | exit 0, lockfile updates |

## Scope

**In scope**:
- Delete `src/` (the whole v1 app), root `index.html`'s v1 wiring, root `vite.config.ts` (v1 build), `tsconfig.app.json`.
- `tsconfig.json` — drop the `tsconfig.app.json` reference.
- `package.json` — repoint default scripts to v2, remove the 5 v1-only deps.
- `v2/vite.config.ts` — becomes the default (see Step 4 for how the default `dev`/`build` should invoke it).

**Out of scope**:
- Anything under `v2/` or `server/` (no source changes — this is a removal + rewiring).
- The `.playwright-mcp/` / design-artifact cleanup (that's plan 015).
- The TypeScript 7 bump (plan 016).

## Steps

### Step 1: Re-verify the v1-only claim before deleting

Run: `grep -rn "react-markdown\|remark-gfm\|lucide-react\|from \"tailwindcss\"\|@tailwindcss/vite\|@import \"tailwindcss\"" v2 server`

Expected: **no matches**. If ANY match appears in `v2/` or `server/`, STOP — the
dep is not v1-only and the removal plan is wrong.

Also confirm v2 does not import from `src/`:
`grep -rn "from \"\.\./src\|from '\.\./src" v2` → no matches. If matched, STOP.

### Step 2: Make v2 the default build target

Two viable approaches — pick the one that keeps `v2/vite.config.ts` as the source
of truth:

**Approach A (recommended, least churn):** keep `v2/vite.config.ts` where it is
and make the default scripts pass `--config v2/vite.config.ts`. Change
`package.json` scripts:
```json
"dev": "vite --config v2/vite.config.ts",
"build": "tsc -p tsconfig.v2.json --noEmit && vite build --config v2/vite.config.ts",
"preview": "vite preview --config v2/vite.config.ts",
"lint": "oxlint v2 server",
```
(The `:v2`-suffixed aliases from plan 001 can now be removed or kept as
synonyms — keep `typecheck:v2` and `verify`; drop `dev:v2`/`build:v2`/`preview:v2`
if you repoint the defaults, to avoid two names for one thing. Update `verify` to
call the new default `build`.)

Do NOT physically move `v2/vite.config.ts` to root in this plan (moving it changes
its relative `__dirname`/path resolution and the bridge spawn path — higher risk).

### Step 3: Delete the v1 app

Delete: `src/` (entire directory), root `index.html`, root `vite.config.ts`,
`tsconfig.app.json`. Remove the `{ "path": "./tsconfig.app.json" }` entry from
`tsconfig.json` (leaving the node + v2 references).

Note: `v2/index.html` already exists (it's v2's entry — confirm with
`ls v2/index.html`). The root `index.html` was v1-only; `v2/vite.config.ts` has
`root: __dirname` (= `v2/`), so it uses `v2/index.html`. Deleting root
`index.html` must not affect the v2 build — verify in Step 5.

### Step 4: Remove the v1-only dependencies

From `package.json`, remove from `dependencies`: `react-markdown`, `remark-gfm`,
`lucide-react`, `tailwindcss`; from `devDependencies`: `@tailwindcss/vite`. Then
`npm install` to update the lockfile.

**Verify**: `npm install` → exit 0.

### Step 5: Verify the v2 build is unaffected

**Verify** (all must pass):
- `npm run typecheck:v2` → exit 0
- `npm run build:v2` → `✓ built`
- `npm run dev` (now the default = v2) → dev server boots on 5173; open
  `http://localhost:5173` and confirm the v2 UI loads (the "Fireflies Live" header,
  Split/Transcript/Chat views). Stop the server.
- `npm run verify` → exit 0
- `grep -rn "react-markdown\|remark-gfm\|lucide-react\|tailwindcss" . --include=package.json` → no matches

### Step 6: Confirm nothing else referenced v1

`grep -rn "src/main\|src/App\|/src/\|tsconfig.app" . --include=*.json --include=*.html --include=*.ts --include=*.mjs` (excluding node_modules, plans/, docs/) →
no live references to the deleted paths remain. Docs may still mention `src/`
(the perf audit noted `docs/INTEGRATION_PLAN.md` refers to `src/App.tsx`) — leave
docs to plan 013; only code/config must be clean.

## Test plan

- No new tests; this is a deletion. The gate is that `npm run verify` still passes
  and the v2 dev server boots and renders (Step 5).
- If plans 002/003 landed, their tests must still pass (`node --test`) after the
  deletion — confirm they don't import anything from `src/`.

## Done criteria

- [ ] `src/`, root `index.html`, root `vite.config.ts`, `tsconfig.app.json` are deleted
- [ ] `tsconfig.json` no longer references `tsconfig.app.json`
- [ ] Default `npm run dev`/`build`/`preview` target the v2 app
- [ ] The 5 v1-only deps are gone from `package.json` and `npm install` succeeded
- [ ] `npm run verify` exits 0 and the v2 dev server renders the UI
- [ ] `grep` finds no code/config references to `src/` or the removed deps
- [ ] `plans/README.md` status row for 008 updated

## STOP conditions

- Step 1 finds a v2/server import of a supposedly-v1-only dep, or a v2 import from
  `src/` — STOP; the app boundary is not as clean as assumed.
- After deletion, `npm run build:v2` fails referencing a deleted file — STOP and
  report which file (a hidden coupling exists).
- The v2 dev server won't boot after repointing the default scripts — revert the
  `package.json` script changes, keep using `dev:v2`, and report.

## Maintenance notes

- After this lands, `mac lockfile prunes linux binaries` caveat still applies to
  deploys (see workspace memory) — unrelated to this change but worth a note if
  this app ever deploys to a Linux host.
- A reviewer should confirm `v2/vite.config.ts`'s bridge-spawn path
  (`path.resolve(__dirname, "../server/bridge.mjs")`) still resolves — it's
  relative to `v2/`, unaffected by deleting root files, but worth a glance.
- Folding `typecheck:v2` into the default `build` (Step 2) means the default build
  now typechecks v2 — the false-confidence gap from plan 001 is fully closed here.

# Plan 001: A one-command verification baseline that actually covers the v2 app

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43c51bd..HEAD -- package.json tsconfig.json tsconfig.app.json v2/`
> If any of those changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx / tests
- **Planned at**: commit `43c51bd`, 2026-07-14

## Why this matters

The active app lives in `v2/`, but `npm run build` typechecks only the legacy
`src/` tree (`tsconfig.app.json` has `"include": ["src"]`). So `tsc -b` passes
green while a real type error sits in the 1000-line `v2/App.tsx` — every Codex
delegation has had to run a *separate* scoped v2 compile by hand to get real
signal, and there is no `npm test` or aggregate `verify` at all. This plan makes
`npm run verify` a single command that typechecks v2, lints, runs tests, and
builds v2 — the gate every future change (and the plans that follow) will use.
It is finding #1 because plans 002 and 003 cannot run without a test runner.

## Current state

- `package.json` scripts (all target the legacy v1 app):
  ```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "oxlint",
    "preview": "vite preview"
  }
  ```
  Node is v20+ (from CLAUDE.md), so `node --test` and `node --test` glob are available with zero new deps.
- `tsconfig.json` references only app + node projects:
  ```json
  { "files": [], "references": [ { "path": "./tsconfig.app.json" }, { "path": "./tsconfig.node.json" } ] }
  ```
- `tsconfig.app.json` ends with `"include": ["src"]` and sets `"noEmit": true`, `"jsx": "react-jsx"`, `"moduleResolution": "bundler"`, `"allowImportingTsExtensions": true`, `"verbatimModuleSyntax": true`, `"skipLibCheck": true` (copy these for the v2 config — v2 imports `.ts`/`.tsx` extensions explicitly, so `allowImportingTsExtensions` is required).
- The v2 app is run with `npx vite --config v2/vite.config.ts` (documented only in `v2/README.md:18`).
- There are **no test files anywhere** in the repo (verified: no `*.test.*` files).

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck v2 | `npx tsc -p tsconfig.v2.json --noEmit` | exit 0, no errors |
| Lint | `npx oxlint v2` | exit 0 (warnings allowed) |
| Tests | `node --test` | 0 fail (0 tests OK at this stage) |
| Build v2 | `npx vite build --config v2/vite.config.ts` | `✓ built` line, exit 0 |
| Aggregate | `npm run verify` | all of the above pass |

## Scope

**In scope** (the only files you should modify/create):
- `tsconfig.v2.json` (create)
- `tsconfig.json` (add one reference entry)
- `package.json` (add scripts only)

**Out of scope** (do NOT touch):
- Any file under `v2/` or `src/` — this plan adds tooling only, no source changes. If `tsc -p tsconfig.v2.json` reveals pre-existing v2 type errors, that is a STOP condition (report them; fixing them is a separate plan).
- `tsconfig.app.json` — leave the v1 config alone; v1 retirement is plan 008.

## Git workflow

- Branch: `advisor/001-verification-baseline`
- Commit style: conventional commits, e.g. `chore(build): add v2 typecheck + verify script`. Do NOT push or open a PR unless the operator says so.

## Steps

### Step 1: Create `tsconfig.v2.json`

Create `tsconfig.v2.json` at the repo root, mirroring `tsconfig.app.json`'s
compilerOptions but scoped to `v2` and standalone (not a composite build ref,
so it can be run directly with `-p`):

```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "esnext",
    "types": ["vite/client", "node"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["v2"]
}
```

Note: `"types": ["node"]` is included because `v2/vite.config.ts` imports
`node:fs`/`node:path`/`node:crypto`. `@types/node` is already a devDependency.

**Verify**: `npx tsc -p tsconfig.v2.json --noEmit` → exit 0, no errors.
If it prints type errors, STOP (see STOP conditions).

### Step 2: Register the v2 config as a build reference

In `tsconfig.json`, add `{ "path": "./tsconfig.v2.json" }` to the `references`
array so `tsc -b` also covers v2:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.v2.json" }
  ]
}
```

`tsc -b` requires referenced projects to be composite. Rather than make
`tsconfig.v2.json` composite (which forces `outDir`/`declaration` plumbing on a
`noEmit` config and can fight the bundler-mode flags), keep the reference for
editor tooling but drive CI off the standalone `-p` invocation in the scripts
below. If `npx tsc -b` now errors with "referenced project may not disable
emit / must have composite", revert this one edit to `tsconfig.json` and rely
solely on the `typecheck:v2` script — note that in your status update.

**Verify**: `npx tsc -p tsconfig.v2.json --noEmit` still exits 0 (the reference
edit must not change v2 typecheck behavior).

### Step 3: Add scripts to `package.json`

Add these to the `scripts` block (keep the existing four unchanged):

```json
"typecheck:v2": "tsc -p tsconfig.v2.json --noEmit",
"dev:v2": "vite --config v2/vite.config.ts",
"build:v2": "vite build --config v2/vite.config.ts",
"preview:v2": "vite preview --config v2/vite.config.ts",
"test": "node --test",
"verify": "npm run typecheck:v2 && npm run lint && npm run test && npm run build:v2"
```

**Verify**: `npm run typecheck:v2` → exit 0; `npm run build:v2` → prints a
`✓ built` line and exits 0.

### Step 4: Confirm the aggregate runs end to end

**Verify**: `npm run verify` → exits 0. `node --test` reports `tests 0` (no test
files yet — plans 002/003 add them); `oxlint` may print warnings but must exit
0; both typecheck and build must pass.

## Test plan

No application tests in this plan — it establishes the *runner* so later plans
can add tests. The verification is that `npm run verify` exists and passes on a
clean tree.

## Done criteria

ALL must hold:

- [ ] `tsconfig.v2.json` exists and `npx tsc -p tsconfig.v2.json --noEmit` exits 0
- [ ] `npm run verify` exits 0
- [ ] `npm run test` runs `node --test` and exits 0
- [ ] `package.json` has `typecheck:v2`, `dev:v2`, `build:v2`, `preview:v2`, `test`, `verify`
- [ ] No files under `v2/` or `src/` were modified (`git status` shows only `package.json`, `tsconfig.json`, `tsconfig.v2.json`)
- [ ] `plans/README.md` status row for 001 updated to DONE

## STOP conditions

Stop and report back (do not improvise) if:

- `npx tsc -p tsconfig.v2.json --noEmit` reports **pre-existing type errors** in
  v2 source. Report the full error list — the codebase has latent type errors
  that need their own fix plan; do not edit v2 source to silence them here.
- `tsc -b` breaks after the Step 2 reference edit and reverting that single edit
  does not restore it.
- `node --test` errors on startup (Node version too old for the flag) — report
  the Node version.

## Maintenance notes

- Once plan 008 (retire v1) lands, fold `typecheck:v2` into the default
  `build`/`typecheck` scripts and drop the `:v2` suffix; until then the suffix
  prevents confusion with the still-present v1 config.
- A reviewer should confirm `verify` is wired as the pre-push gate (a git
  `pre-push` hook running `npm run verify` is the realistic ceiling here — no CI
  runner exists in this workspace).
- `node --test` discovers `*.test.*` / files under `test/` by default; plans
  002/003 place tests accordingly.

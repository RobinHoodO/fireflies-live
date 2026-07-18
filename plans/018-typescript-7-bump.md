# Plan 018: Bump TypeScript 6 → 7 (and @types/node 24 → 26)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 70bc54e..HEAD -- package.json package-lock.json tsconfig.json tsconfig.v2.json tsconfig.node.json v2/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S–M (S if zero new type errors; M if the new compiler surfaces some)
- **Risk**: MED (new major compiler; mitigated by the `npm run verify` gate)
- **Depends on**: none (its stated prerequisites — plans 001 and 008 — landed 2026-07-15)
- **Category**: migration
- **Planned at**: commit `70bc54e`, 2026-07-18

## Why this matters

The repo pins `typescript ~6.0.2`; the current stable release is **7.0.2**
(checked on npm 2026-07-18: `latest: 7.0.2`). This was the one major-version
lag flagged in the round-1 dependency audit (DEPS-02, deferred in
`plans/README.md`) and its two stated prerequisites are now done: v2 is
actually typechecked (plan 001) and the dead v1 tree is gone (plan 008), so
the bump is small and its blast radius is fully covered by `npm run verify`.
TypeScript 7 is the natively-compiled compiler line — staying on 6.x means
drifting further from where lib typings, `@types/*` packages, and tooling are
moving. `@types/node` (24.x here, 26.1.1 current) rides along as the routine
companion bump, per the round-1 deferral note.

## Current state

Relevant files:

- `package.json` — devDependencies: `"typescript": "~6.0.2"`,
  `"@types/node": "^24.13.2"`. Scripts (the verify gate):

```json
"build": "tsc -p tsconfig.v2.json --noEmit && vite build --config v2/vite.config.ts",
"typecheck:v2": "tsc -p tsconfig.v2.json --noEmit",
"test": "node --test",
"verify": "npm run lint && npm run test && npm run build"
```

- `tsconfig.json` — solution file: `files: []`, references to
  `./tsconfig.node.json` and `./tsconfig.v2.json`.
- `tsconfig.v2.json` — the app's config (`include: ["v2"]`), options:
  `target es2023`, `module esnext`, `moduleResolution bundler`,
  `allowImportingTsExtensions`, `verbatimModuleSyntax`, `moduleDetection force`,
  `noEmit`, `jsx react-jsx`, `strict`, `noFallthroughCasesInSwitch`,
  `types: ["vite/client", "node"]`, `skipLibCheck`.
- `tsconfig.node.json` — for `v2/vite.config.ts`; additionally uses
  `module nodenext`, `noUnusedLocals`, `noUnusedParameters`,
  `erasableSyntaxOnly`, `tsBuildInfoFile`.
- `v2/*.ts(x)` — the only typechecked source (~1.9k lines across `App.tsx`,
  `backend.ts`, `data.ts`, `md.ts`, `icons.tsx`, `main.tsx`, tests).
  `server/*.mjs` is plain JS and unaffected.

Node runtime: the repo runs `.ts` tests natively on Node 22 (type stripping) —
the TS version bump doesn't change that path, only `tsc`.

## Commands you will need

| Purpose   | Command                                            | Expected on success |
|-----------|----------------------------------------------------|---------------------|
| Install   | `npm install -D typescript@^7.0.2 "@types/node@^26"` | exit 0 |
| Typecheck | `npm run typecheck:v2`                             | exit 0, no errors |
| Full gate | `npm run verify`                                   | lint + tests + build green |
| Sanity    | `npx tsc --version`                                | prints `7.0.x` |

## Scope

**In scope** (the only files you should modify):
- `package.json`, `package-lock.json` (the two dependency lines)
- `tsconfig.v2.json`, `tsconfig.node.json`, `tsconfig.json` — **only if** tsc 7
  rejects a currently-used option (see STOP conditions for what's allowed)
- `v2/*.ts` / `v2/*.tsx` — **only** minimal edits that fix type errors the new
  compiler actually reports

**Out of scope** (do NOT touch, even though they look related):
- `server/*.mjs` (untyped, not compiled)
- `vite`, `@vitejs/plugin-react`, `oxlint`, React deps — no opportunistic bumps
- Any refactor beyond the minimal fix for a reported error; no `any`-scattering
  (prefer the precise type; if a fix needs more than ~5 lines, see STOP)

## Git workflow

- Work directly on `main`; one conventional commit, e.g.
  `chore(deps): bump typescript to 7.x, @types/node to 26 (plan 018)`.
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Bump

Run `npm install -D typescript@^7.0.2 "@types/node@^26"`.

**Verify**: `npx tsc --version` → `Version 7.0.x`; `git diff package.json` →
exactly the two devDependency lines changed.

### Step 2: Typecheck

Run `npm run typecheck:v2`.

- Exit 0 → go to Step 3.
- Type errors → fix each with the smallest correct change in the reporting
  file. Re-run until clean. Typical TS-major noise: stricter lib DOM typings
  and narrowed inference — fix the code, don't loosen `tsconfig`.
- Option errors (tsc refuses an option) → see STOP conditions.

**Verify**: `npm run typecheck:v2` → exit 0.

### Step 3: Full gate

Run `npm run verify` (lint + `node --test` + typechecked vite build).

**Verify**: exit 0; test count ≥ the pre-bump count (run `npm run test` before
Step 1 if you need the baseline number).

## Test plan

No new tests — this is a toolchain bump; the 38+ existing tests plus the v2
typecheck/build ARE the test. The verify gate must be green at the commit.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx tsc --version` prints 7.0.x
- [ ] `node -e "console.log(require('./package.json').devDependencies['@types/node'])"` prints a ^26 range
- [ ] `npm run verify` exits 0
- [ ] `git status` clean after commit; diff touches only in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- tsc 7 **rejects a tsconfig option** the repo uses (listed in Current state).
  Removing a redundant-but-now-default option is allowed; changing semantics
  (e.g. dropping `verbatimModuleSyntax`, weakening `strict`, switching
  `moduleResolution`) is not — report which option and the exact error instead.
- Any single type error needs more than ~5 changed lines, or a fix would change
  runtime behavior (not just types).
- `vite build` fails after the typecheck passes (plugin/toolchain
  incompatibility with TS 7 — that's a bigger conversation, not a workaround).
- `npm install` resolves typescript to anything other than 7.0.x, or reports
  peer-dependency conflicts.

## Maintenance notes

- After this lands, future `@types/*` bumps are routine minors again.
- Reviewer: scrutinize any `v2/` source edits — they should each map to a
  specific new compiler error, nothing speculative.
- Deliberately not done here: bumping vite/react/oxlint majors (none are
  lagging), and any `tsc -b` build-mode adoption beyond what exists.

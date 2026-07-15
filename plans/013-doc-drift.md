# Plan 013: Fix the actively-wrong docs (FEATURES.md, INTEGRATION_PLAN.md)

> **Executor instructions**: Follow step by step. Verify each claim against live
> code before writing it. On a STOP condition, stop and report. Update
> `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 43c51bd..HEAD -- v2/ docs/`. If v2 code changed, re-confirm the feature statuses against current code.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (but best after plan 008 so any `src/` references reflect reality)
- **Category**: docs
- **Planned at**: commit `43c51bd`, 2026-07-14

## Why this matters

Stale docs that are actively wrong are worse than missing — an agent trusting them
re-implements shipped features or uses dead vocabulary. `docs/FEATURES.md` marks
shipped features as planned, states a stale default model, and contradicts itself;
`docs/INTEGRATION_PLAN.md` points at a `~/Desktop` path that has moved into the
repo. `docs/ROADMAP.md` is accurate and is the real source of truth.

## Current state (evidence to fix)

`docs/FEATURES.md`:
- `:48` "Session persistence (localStorage) ⬜ Phase 2" — SHIPPED (`v2/App.tsx:21,166`; `ROADMAP.md:64` "shipped 2026-07-12").
- `:49` "Keyboard shortcuts ⬜ Phase 2" — SHIPPED (`v2/App.tsx:391-403`; `ROADMAP.md:65`).
- `:21` "6 models, DeepSeek default" — the default is `anthropic/claude-sonnet-5` (`v2/App.tsx:93`), and `:47` of the same doc says "~22 models" (self-contradiction).
- `:34` filter labelled "question/action/insight" — the live taxonomy is `ask/do/note/command` (`v2/backend.ts:27,155`).

`docs/INTEGRATION_PLAN.md`:
- `:8` references `~/Desktop/Fireflies Live (standalone).html` — that file now
  lives at the repo root (`Fireflies Live (standalone).html`).

## Scope

**In scope**: `docs/FEATURES.md`, `docs/INTEGRATION_PLAN.md`.
**Out of scope**: `docs/ROADMAP.md` (accurate — leave it), any code.

## Steps

### Step 1: Correct FEATURES.md against live code

For each claim above, confirm the current code state (open the cited `v2/` lines),
then edit `docs/FEATURES.md`:
- Flip lines 48-49 to ✅ with the shipped date/phase matching ROADMAP.
- Fix the default-model note (`:21`) to the real default and reconcile the model
  count with `:47`.
- Update the filter taxonomy (`:34`) to `ask/do/note/command`.
- Add a one-line header pointing to `ROADMAP.md` as the authority, to reduce
  future re-drift.

**Verify**: `grep -n "⬜ Phase 2" docs/FEATURES.md` → the persistence/shortcuts
lines no longer match; `grep -n "DeepSeek default" docs/FEATURES.md` → gone.

### Step 2: Fix the INTEGRATION_PLAN path

Update `docs/INTEGRATION_PLAN.md:8` to the repo-root filename (or a `resources/`
path if the file was moved there — check `ls` first).

**Verify**: `grep -n "~/Desktop" docs/INTEGRATION_PLAN.md` → no matches.

## Done criteria

- [ ] FEATURES.md shows persistence + shortcuts as shipped, correct default model, consistent model count, correct filter taxonomy
- [ ] FEATURES.md points at ROADMAP.md as the source of truth
- [ ] INTEGRATION_PLAN.md no longer references a `~/Desktop` path
- [ ] No code files changed (`git status` shows only the two docs)
- [ ] `plans/README.md` status row for 013 updated

## STOP conditions

- A feature you were about to mark shipped isn't actually in the code (drift since
  the audit) — report the discrepancy rather than documenting a false state.

## Maintenance notes

- Consider collapsing FEATURES.md into ROADMAP.md long-term — two feature lists is
  the reason they drift. For now, the pointer header is the lazy fix.

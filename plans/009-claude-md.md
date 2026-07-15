# Plan 009: Add a root CLAUDE.md so agents stop re-deriving the repo's shape

> **Executor instructions**: Follow step by step. This plan writes one doc file;
> the "verification" is that every fact in it is confirmed against live code, not
> copied from here blindly. On a STOP condition, stop and report. Update
> `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 43c51bd..HEAD -- package.json v2/ server/`
> If commands/paths changed, confirm the current values before writing them into
> CLAUDE.md.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-verification-baseline.md, plans/008-retire-legacy-v1.md (so the documented commands are the final ones)
- **Category**: dx / docs
- **Planned at**: commit `43c51bd`, 2026-07-14

## Why this matters

This repo is developed almost entirely by delegated agents (see
`docs/codex-delegation-log.md`), yet it has no `CLAUDE.md`/`AGENTS.md`. Every
session must re-derive the non-obvious facts: that `v2/` is the active app and
`src/` is legacy, how to run/build/verify, that the bridge is security-sensitive
and which invariants must never regress, and where env lives. That rediscovery is
paid per session. A tight root `CLAUDE.md` — a map with pointers, not an
encyclopedia — removes it.

## Current state

- No `CLAUDE.md` or `AGENTS.md` at repo root (verified).
- Operating facts are scattered: v2-is-active in `v2/README.md`, the run command
  in `v2/README.md:18`, the bridge security model in comments across
  `server/bridge.mjs:9,73,116-119,386-388`, the roadmap in `docs/ROADMAP.md`.
- After plans 001 + 008, the canonical commands are `npm run dev` / `npm run
  build` / `npm run verify` (v2-targeted), and `npm test` (`node --test`).
- The workspace has a global CLAUDE.md convention: "a map with pointers, not an
  encyclopedia" — match that terse, pointer-first style.

## Scope

**In scope**: `CLAUDE.md` (create at repo root).

**Out of scope**: any code change; editing the docs under `docs/` (that's plan
013). Do not duplicate the roadmap — link to it.

## Steps

### Step 1: Confirm the facts you're about to document

Run and note the actual outputs (do not trust this plan's assumptions if plans
001/008 changed things):
- `cat package.json` → the real `scripts` block.
- `ls v2/ src/ 2>/dev/null` → whether `src/` still exists (plan 008 may have
  removed it; document reality).
- `sed -n '380,389p' server/bridge.mjs` → the ponytail note on the denylist.

### Step 2: Write `CLAUDE.md`

Create `CLAUDE.md` at the repo root, ≤~60 lines, covering exactly these sections
(fill commands/paths from Step 1's real output):

1. **What this is** — one line: a live meeting copilot; the "during-meeting" layer
   of the sales OS (research before → live copilot → meeting-analyser after). Link
   `docs/ROADMAP.md` as the source of truth for status.
2. **Active app** — `v2/` is the app. If `src/` still exists: "`src/` is legacy
   v1 — do not edit." If plan 008 removed it, say so.
3. **Run / build / verify** — the real commands from Step 1. Call out that
   `npm run verify` is the gate to run before considering any change done, and
   what it chains (typecheck v2 + lint + test + build).
4. **Bridge security invariants (never regress)** — `server/bridge.mjs` is
   loopback-only; every protected endpoint checks a per-session bearer token; the
   Host header is allowlisted (anti DNS-rebinding); the denylist is a fat-finger
   guard, not a sandbox (quote the ponytail note); file reads are rooted under
   `content/`/`clients/`; `/file` writes only into the fixed transcripts dir with a
   sanitized slug. Point at `server/bridge.test.mjs` as the guard's regression net.
5. **Env** — keys live at `/Users/robinsverd/Thrivbe-AI/.env`
   (`FIREFLY_API_KEY` = the Fireflies token despite the name, `OPENROUTER_API`);
   injected by the dev middleware, never hardcoded. Reference names only — never
   paste values.
6. **Conventions** — inline-style objects everywhere (design-port convention, not
   a mistake); small files; the delegation + verify-before-commit workflow
   (`docs/codex-delegation-log.md`).

Keep it pointers-first. Do not restate the roadmap or re-explain features.

**Verify**: `test -f CLAUDE.md && wc -l CLAUDE.md` → file exists, roughly ≤60 lines.

### Step 3: Cross-check every command actually works

For each command you documented in section 3, run it once and confirm it behaves
as described (e.g. `npm run verify` → exit 0). A CLAUDE.md that lists a command
that doesn't work is worse than none.

**Verify**: each documented command runs as stated.

## Test plan

- No automated test. The gate is Step 3: every documented command is executed and
  confirmed.

## Done criteria

- [ ] `CLAUDE.md` exists at repo root, pointer-first, ≤~60 lines
- [ ] It states which app is active and (accurately) whether `src/` still exists
- [ ] It lists the real run/build/verify commands, each confirmed to work
- [ ] It documents the bridge security invariants and points at the guard tests
- [ ] It references env by name/location only — no secret values
- [ ] `plans/README.md` status row for 009 updated

## STOP conditions

- A command you were about to document does not work (e.g. `npm run verify` fails
  on a clean tree) — STOP; the tooling isn't ready (plan 001 may be incomplete).
- `src/` state is ambiguous (partially deleted) — report; don't document a
  half-state.

## Maintenance notes

- Keep CLAUDE.md lean; when commands change, update it in the same PR. It reloads
  every agent session, so prose is expensive — pointers over paragraphs.
- If this app is later absorbed into Command Center (roadmap 6.3), the run/env
  sections change substantially — revisit then.
